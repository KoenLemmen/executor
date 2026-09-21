/**
 * FumaDB's own foreign key engine (`relationMode: "fumadb"`).
 *
 * Wraps an {@link OrmAdapter} and enforces every `ForeignKey` of the schema in
 * FumaDB instead of in the database. This is the default on MSSQL, where the
 * database refuses the cascade graphs FumaDB schemas commonly describe.
 *
 * Violations fail with Effect SQL's `SqlError` carrying a `ConstraintError`
 * reason, so a caller sees the same error type whether the constraint lives in
 * the database or in FumaDB.
 */
import { DateTime, Effect, Equal, Option } from "effect";
import { ConstraintError, SqlError } from "effect/unstable/sql/SqlError";
import type { AnyColumn } from "../../contracts/schema/column.ts";
import type { ForeignKey } from "../../contracts/schema/relation.ts";
import type { AnySchema } from "../../contracts/schema/schema.ts";
import type { AnyTable } from "../../contracts/schema/table.ts";
import { Condition } from "../../contracts/condition.ts";
import type { OrmError } from "../../contracts/query.ts";
import type {
  CompiledFindOptions,
  CompiledUpsert,
  OrmAdapter,
  Row,
} from "../../contracts/query-adapter.ts";

/** A `[referencing column, referenced column]` pair of a foreign key. */
type ColumnPair = readonly [AnyColumn, AnyColumn];

/** Zip the two parallel column lists of a foreign key. */
const pairsOf = (key: ForeignKey): ReadonlyArray<ColumnPair> => {
  const out: Array<ColumnPair> = [];
  for (let i = 0; i < key.columns.length; i++) {
    const column = key.columns[i];
    const referenced = key.referencedColumns[i];
    if (column === undefined || referenced === undefined) continue;
    out.push([column, referenced]);
  }
  return out;
};

/** `NULL` foreign key values are never checked, exactly like a SQL foreign key. */
/** `NULL`, absent, or `Option.none()`: a join value that can never reference a row. */
const isAbsent = (value: unknown): boolean =>
  value === null || value === undefined || (Option.isOption(value) && Option.isNone(value));

/** Select every column of the rows matching `where`. */
const findAll = (where: Condition | undefined): CompiledFindOptions => ({
  select: true,
  computed: [],
  where,
  orderBy: undefined,
  join: undefined,
  limit: undefined,
  offset: undefined,
});

/** The failure raised for a violated foreign key. `operation` names the write that violated it. */
const violation = (key: ForeignKey, operation: string): SqlError => {
  const message = `foreign constraint failed ${key.name}`;
  return new SqlError({
    reason: new ConstraintError({ cause: new Error(message), message, operation }),
  });
};

/**
 * Rows of `key.table` that reference any of `targets`.
 *
 * `undefined` when no target can be referenced, because every candidate had a
 * `NULL` in a referenced column.
 */
const referencingCondition = (
  pairs: ReadonlyArray<ColumnPair>,
  targets: ReadonlyArray<Row>,
): Condition | undefined => {
  const items: Array<Condition> = [];
  for (const target of targets) {
    const conditions: Array<Condition> = [];
    let containsNull = false;
    for (const [column, referenced] of pairs) {
      const value = target[referenced.ormName];
      if (isAbsent(value)) {
        containsNull = true;
        break;
      }
      conditions.push(Condition.Compare({ column, operator: "=", value }));
    }
    if (!containsNull) items.push(Condition.And({ items: conditions }));
  }
  return items.length === 0 ? undefined : Condition.Or({ items });
};

/**
 * Whether the insert at `index` needs no check of its own.
 *
 * Two cases, both from upstream fumadb:
 * 1. An earlier insert in the same batch carries the same foreign key values.
 * 2. On a self-referencing key, an earlier insert in the same batch *is* the
 *    row being referenced, so it will exist once the batch is written.
 */
const shouldSkipChecking = (
  key: ForeignKey,
  pairs: ReadonlyArray<ColumnPair>,
  inserts: ReadonlyArray<Row>,
  index: number,
): boolean => {
  const insert = inserts[index];
  if (insert === undefined) return true;
  const selfReferencing = key.table === key.referencedTable;
  for (let prior = 0; prior < index; prior++) {
    const earlier = inserts[prior];
    if (earlier === undefined) continue;
    if (pairs.every(([column]) => Equal.equals(insert[column.ormName], earlier[column.ormName])))
      return true;
    if (
      selfReferencing &&
      pairs.every(([column, referenced]) =>
        Equal.equals(insert[column.ormName], earlier[referenced.ormName]),
      )
    ) {
      return true;
    }
  }
  return false;
};

/** Identity of a row inside one cascade run. */
const visitKey = (table: AnyTable, id: unknown): string =>
  JSON.stringify([
    table.ormName,
    DateTime.isDateTime(id)
      ? `dt:${DateTime.toEpochMillis(id)}`
      : id instanceof Date
        ? `date:${id.getTime()}`
        : String(id),
  ]);

/**
 * The bookkeeping of one top-level `updateMany` or `deleteMany` call.
 *
 * A cascade re-enters this engine instead of the raw adapter, so that a
 * grandchild is reached too. That needs two guards:
 *
 * - `deleted` / `deletedIds`: rows the run already removes. They are skipped
 *   when the cascade reaches them again, and excluded from every `RESTRICT`
 *   check, because a row that the same operation deletes cannot hold back the
 *   operation that deletes it. This is SQL's statement level `NO ACTION` rule
 *   and it keeps upstream's behaviour for a cascade that removes both sides of
 *   a self-referencing key.
 * - `updating`: the rows on the current update path. A foreign key cycle with
 *   `onUpdate: "CASCADE"` would otherwise cascade between the two tables for
 *   ever. The outer call still writes the row, so no update is lost.
 */
interface CascadeState {
  readonly deleted: Set<string>;
  readonly deletedIds: Map<string, Array<unknown>>;
  readonly updating: Set<string>;
}

/** Fresh bookkeeping for one top-level write. */
const makeCascadeState = (): CascadeState => ({
  deleted: new Set<string>(),
  deletedIds: new Map<string, Array<unknown>>(),
  updating: new Set<string>(),
});

/** Record that this run deletes `id` of `table`. Returns `false` when it was already recorded. */
const scheduleDelete = (state: CascadeState, table: AnyTable, id: unknown): boolean => {
  const key = visitKey(table, id);
  if (state.deleted.has(key)) return false;
  state.deleted.add(key);
  if (isAbsent(id)) return true;
  const list = state.deletedIds.get(table.ormName);
  if (list === undefined) state.deletedIds.set(table.ormName, [id]);
  else list.push(id);
  return true;
};

/** `where`, narrowed to the rows of `table` that this run does not delete. */
const withoutDeleted = (state: CascadeState, table: AnyTable, where: Condition): Condition => {
  const ids = state.deletedIds.get(table.ormName);
  if (ids === undefined || ids.length === 0) return where;
  return Condition.And({
    items: [
      where,
      Condition.Compare({ column: table.getIdColumn(), operator: "not in", value: [...ids] }),
    ],
  });
};

/**
 * Enforce the foreign keys of `schema` on top of `adapter`.
 *
 * Only tables that own a foreign key, or that a foreign key references, get
 * the extra work; every other table passes straight through to `adapter`.
 *
 * - `create` / `createMany` generate the column defaults up front, so the
 *   foreign key values are known, then check every key of the table.
 * - `updateMany` and `deleteMany` run their checks and writes inside
 *   `adapter.transaction`, so a `RESTRICT` failure rolls back the cascades
 *   that already ran. A cascade re-enters this engine, so it reaches a
 *   grandchild as well; see {@link CascadeState} for the guards that keeps a
 *   foreign key cycle finite.
 * - `upsert` is reimplemented on `findFirst` plus `create` / `updateMany`, so
 *   the row it writes goes through the same checks and cascades.
 *
 * `count`, `findFirst`, `findMany`, and `transaction` are passed through.
 */
export const createSoftForeignKey = <R>(
  schema: AnySchema,
  adapter: OrmAdapter<R>,
): OrmAdapter<R> => {
  // referenced table ORM name -> the foreign keys pointing at it
  const childForeignKeys = new Map<string, Array<ForeignKey>>();
  for (const table of Object.values(schema.tables)) {
    for (const key of table.foreignKeys) {
      const name = key.referencedTable.ormName;
      const list = childForeignKeys.get(name);
      if (list === undefined) childForeignKeys.set(name, [key]);
      else list.push(key);
    }
  }

  /** Whether any row of `table` matches `where`, ignoring the rows this run deletes. */
  const exists = Effect.fnUntraced(function* (
    table: AnyTable,
    where: Condition,
    state: CascadeState,
  ) {
    const row = yield* adapter.findFirst(table, {
      ...findAll(withoutDeleted(state, table, where)),
      select: [table.getIdColumn().ormName],
    });
    return row !== null;
  });

  /** Fill in every column default the caller omitted, so the check sees the final row. */
  const generateDefaults = Effect.fnUntraced(function* (table: AnyTable, values: Row) {
    const out: Row = {};
    for (const [name, value] of Object.entries(values)) {
      if (value !== undefined) out[name] = value;
    }
    for (const [name, column] of Object.entries(table.columns)) {
      if (Object.hasOwn(out, name)) continue;
      const generated = yield* column.generateDefault();
      if (generated !== undefined) out[name] = generated;
    }
    return out;
  });

  /** Every referenced row of `key` must already exist, or be created by the same batch. */
  const checkForeignKeyOnInsert = Effect.fnUntraced(function* (
    key: ForeignKey,
    inserts: ReadonlyArray<Row>,
  ) {
    const pairs = pairsOf(key);
    const entries: Array<Condition> = [];
    for (let index = 0; index < inserts.length; index++) {
      const insert = inserts[index];
      if (insert === undefined) continue;
      if (shouldSkipChecking(key, pairs, inserts, index)) continue;

      const items: Array<Condition> = [];
      let containsNull = false;
      for (const [column, referenced] of pairs) {
        const value = insert[column.ormName];
        if (isAbsent(value)) {
          containsNull = true;
          break;
        }
        items.push(Condition.Compare({ column: referenced, operator: "=", value }));
      }
      if (!containsNull) entries.push(Condition.And({ items }));
    }

    if (entries.length === 0) return;
    const count = yield* adapter.count(key.referencedTable, {
      where: Condition.Or({ items: entries }),
    });
    if (count < entries.length) return yield* Effect.fail(violation(key, "insert"));
  });

  // `foreignKeyOnUpdate` and `updateManyImpl` call each other, so both carry an
  // explicit type: a CASCADE on update may have to cascade again one level down.
  /** Apply `key.onUpdate` to the rows referencing `targets`, before `targets` change. */
  const foreignKeyOnUpdate: (
    key: ForeignKey,
    set: Row,
    targets: ReadonlyArray<Row>,
    state: CascadeState,
  ) => Effect.Effect<void, OrmError, R> = Effect.fnUntraced(function* (
    key: ForeignKey,
    set: Row,
    targets: ReadonlyArray<Row>,
    state: CascadeState,
  ) {
    const pairs = pairsOf(key);
    // nothing to do unless the update touches a referenced column
    if (!pairs.some(([, referenced]) => set[referenced.ormName] !== undefined)) return;

    const affected = referencingCondition(pairs, targets);
    if (affected === undefined) return;

    if (key.onUpdate === "RESTRICT") {
      if (yield* exists(key.table, affected, state))
        return yield* Effect.fail(violation(key, "update"));
      return;
    }

    const mapped: Row = {};
    for (const [column, referenced] of pairs) {
      if (key.onUpdate === "SET NULL") {
        mapped[column.ormName] = null;
        continue;
      }
      // CASCADE: only the referenced columns the update actually changes
      const value = set[referenced.ormName];
      if (value !== undefined) mapped[column.ormName] = value;
    }
    if (Object.keys(mapped).length === 0) return;
    yield* updateManyImpl(key.table, mapped, affected, state);
  });

  /**
   * Update the rows matching `where`, applying `onUpdate` of every foreign key
   * that references `table` first.
   *
   * Rows already on the update path of `state` are left out: the call that put
   * them there writes them, so the cascade of a foreign key cycle ends.
   */
  const updateManyImpl: (
    table: AnyTable,
    set: Row,
    where: Condition | undefined,
    state: CascadeState,
  ) => Effect.Effect<void, OrmError, R> = Effect.fnUntraced(function* (
    table: AnyTable,
    set: Row,
    where: Condition | undefined,
    state: CascadeState,
  ) {
    const foreignKeys = childForeignKeys.get(table.ormName);
    if (foreignKeys === undefined) return yield* adapter.updateMany(table, { set, where });

    const idColumn = table.getIdColumn();
    // resolve the affected rows first: the cascades below change what `where` matches
    const found = yield* adapter.findMany(table, findAll(where));
    const targets: Array<Row> = [];
    const path: Array<string> = [];
    for (const row of found) {
      const marker = visitKey(table, row[idColumn.ormName]);
      if (state.updating.has(marker)) continue;
      path.push(marker);
      targets.push(row);
    }
    if (targets.length === 0) return;

    for (const marker of path) state.updating.add(marker);
    for (const key of foreignKeys) yield* foreignKeyOnUpdate(key, set, targets, state);

    yield* adapter.updateMany(table, {
      set,
      where: Condition.Compare({
        column: idColumn,
        operator: "in",
        value: targets.map((target) => target[idColumn.ormName]),
      }),
    });
    // the whole run is abandoned on failure, so the path only has to be
    // unwound when the update actually completed
    for (const marker of path) state.updating.delete(marker);
  });

  /**
   * Delete the rows matching `where`, applying `onDelete` of every foreign key
   * that references `table` first.
   *
   * A `CASCADE` and a `SET NULL` both re-enter the engine, so the rule of the
   * next level down applies as well.
   */
  const deleteManyImpl: (
    table: AnyTable,
    where: Condition | undefined,
    state: CascadeState,
  ) => Effect.Effect<void, OrmError, R> = Effect.fnUntraced(function* (
    table: AnyTable,
    where: Condition | undefined,
    state: CascadeState,
  ) {
    const foreignKeys = childForeignKeys.get(table.ormName);
    if (foreignKeys === undefined) return yield* adapter.deleteMany(table, { where });

    const idColumn = table.getIdColumn();
    const found = yield* adapter.findMany(table, findAll(where));
    const targets: Array<Row> = [];
    for (const row of found) {
      if (scheduleDelete(state, table, row[idColumn.ormName])) targets.push(row);
    }
    if (targets.length === 0) return;

    for (const key of foreignKeys) {
      const affected = referencingCondition(pairsOf(key), targets);
      if (affected === undefined) continue;

      if (key.onDelete === "CASCADE") {
        yield* deleteManyImpl(key.table, affected, state);
        continue;
      }
      if (key.onDelete === "SET NULL") {
        const set: Row = {};
        for (const column of key.columns) set[column.ormName] = null;
        // through the engine, so `onUpdate` of the next level down applies
        yield* updateManyImpl(key.table, set, affected, state);
        continue;
      }
      if (yield* exists(key.table, affected, state))
        return yield* Effect.fail(violation(key, "delete"));
    }

    yield* adapter.deleteMany(table, {
      where: Condition.Compare({
        column: idColumn,
        operator: "in",
        value: targets.map((target) => target[idColumn.ormName]),
      }),
    });
  });

  const wrapped: OrmAdapter<R> = {
    tables: adapter.tables,
    count: adapter.count,
    findFirst: adapter.findFirst,
    findMany: adapter.findMany,
    transaction: adapter.transaction,

    create: Effect.fn("FumaDB.SoftForeignKey.create")(function* (table: AnyTable, values: Row) {
      if (table.foreignKeys.length === 0) return yield* adapter.create(table, values);
      const withDefaults = yield* generateDefaults(table, values);
      for (const key of table.foreignKeys) yield* checkForeignKeyOnInsert(key, [withDefaults]);
      return yield* adapter.create(table, withDefaults);
    }),

    createMany: Effect.fn("FumaDB.SoftForeignKey.createMany")(function* (
      table: AnyTable,
      values: ReadonlyArray<Row>,
    ) {
      if (table.foreignKeys.length === 0) return yield* adapter.createMany(table, values);
      const withDefaults: Array<Row> = [];
      for (const value of values) withDefaults.push(yield* generateDefaults(table, value));
      for (const key of table.foreignKeys) yield* checkForeignKeyOnInsert(key, withDefaults);
      return yield* adapter.createMany(table, withDefaults);
    }),

    updateMany: Effect.fn("FumaDB.SoftForeignKey.updateMany")(function* (
      table: AnyTable,
      options: { readonly where: Condition | undefined; readonly set: Row },
    ) {
      if (!childForeignKeys.has(table.ormName)) return yield* adapter.updateMany(table, options);
      return yield* adapter.transaction(
        updateManyImpl(table, options.set, options.where, makeCascadeState()),
      );
    }),

    deleteMany: Effect.fn("FumaDB.SoftForeignKey.deleteMany")(function* (
      table: AnyTable,
      options: { readonly where: Condition | undefined },
    ) {
      if (!childForeignKeys.has(table.ormName)) return yield* adapter.deleteMany(table, options);
      return yield* adapter.transaction(deleteManyImpl(table, options.where, makeCascadeState()));
    }),

    upsert: Effect.fn("FumaDB.SoftForeignKey.upsert")(function* (
      table: AnyTable,
      options: CompiledUpsert,
    ) {
      if (table.foreignKeys.length === 0 && !childForeignKeys.has(table.ormName)) {
        return yield* adapter.upsert(table, options);
      }

      const target = yield* adapter.findFirst(table, findAll(options.where));
      if (target === null) {
        if (options.returning) return yield* wrapped.create(table, options.create);
        yield* wrapped.createMany(table, [options.create]);
        return undefined;
      }

      const idColumn = table.getIdColumn();
      const where = Condition.Compare({
        column: idColumn,
        operator: "=",
        value: target[idColumn.ormName],
      });
      yield* wrapped.updateMany(table, { where, set: options.update });
      if (!options.returning) return undefined;
      // the database may encode or transform what was written, so read it back
      const row = yield* adapter.findFirst(table, findAll(where));
      return row ?? undefined;
    }),
  };

  return wrapped;
};
