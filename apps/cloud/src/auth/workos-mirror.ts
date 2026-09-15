// ---------------------------------------------------------------------------
// WorkOsMirror — the WRITE side of cloud's local membership mirror.
//
// WorkOS owns users and organization memberships. This service keeps the
// `accounts` / `memberships` rows (db/schema.ts) in step with it so the read
// side (`auth/member-directory.ts`, the cloud `MemberDirectory`) never has to
// ask WorkOS. Three feeders write through it: the login callback (user +
// memberships already in hand), Executor-initiated changes (write-through),
// and the WorkOS Events API reconciler (dashboard-side changes, replayed in
// order from a persisted cursor).
//
// Every write is idempotent and out-of-order safe. Both upserts carry the
// WorkOS `updatedAt` of their payload and refuse to overwrite a row whose
// stored `workos_updated_at` is newer, so a replayed or late-arriving event
// can never regress the mirror. A delete never drops the row: it TOMBSTONES
// it (`status = 'inactive'`, `workos_updated_at` = the deletion time) — and
// INSERTS the tombstone when the row is not there yet — so a feeder that
// fetched the membership before the deletion and writes it after (a login,
// the backfill) is refused by that same guard instead of reinstating access;
// only a payload newer than the deletion (the member re-added in WorkOS)
// reactivates it. At an EQUAL timestamp the tombstone wins: a live row
// accepts a payload stamped the same instant (feeders replay the same
// payload and must converge), a tombstone does not, so a deletion at T is
// never undone by an active payload at T. Every stamp is on WorkOS's clock:
// a deletion replayed from the events stream is stamped with the event's
// time; one Executor made itself — WorkOS answers a delete with no time —
// is stamped with the `updatedAt` WorkOS last reported for the membership,
// or keeps the stamp the row already holds. Never a local clock: read after
// WorkOS answered, it can post-date a replacement membership WorkOS created
// for the same member meanwhile, and a tombstone stamped with it would
// refuse that replacement for good. The row tombstone can only speak for the
// membership id the row happens to hold, so every delete ALSO records the
// deleted WorkOS id in `membership_tombstones`, a ledger keyed by that id
// alone: WorkOS never reuses a deleted `om_…` id, so no membership write
// naming a recorded id is ever current, however it is stamped. That is what
// covers the case the row cannot: membership A replaced by B in WorkOS before
// the mirror saw either, B then deleted — the delete finds a row holding A
// (not B's to tombstone) and would otherwise leave nothing behind, and a
// later scan that still lists B would insert it live, stamped after A. With
// the ledger the delete is recorded whatever the row holds, and the scan's
// payload is refused by identity. A deleted USER is protected by identity
// the same way: `deleteUser` leaves the account row behind as a tombstone
// (profile cleared, stamped with the deletion), and no membership naming
// that account is ever written again, however the payload is stamped —
// WorkOS never reuses a user id, and a membership the mirror had not seen
// has no row of its own for a timestamp guard to refuse the insert against.
// The cursor advances only by compare-and-set, so two reconciler runs cannot
// both own the stream.
//
// Per-request layer shape, like `UserStoreService`: it holds the request's
// postgres socket, so it is rebuilt per request (`RequestScopedServicesLive`)
// and never shared across Workers requests.
// ---------------------------------------------------------------------------

import { and, eq, isNotNull, isNull, lt, ne, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Context, Effect, Layer, Schema } from "effect";

import { type MemberStatus } from "@executor-js/api/server";

import { accounts, membershipTombstones, memberships, workosSync } from "../db/schema";
import { DbService, type DrizzleDb } from "../db/db";
import {
  USER_STORE_FAILURE_REASONS,
  tryPromiseService,
  userStoreReasonFromCause,
  withServiceLogging,
} from "./errors";

/** A WorkOS user, as the mirror stores it. `updatedAt` is WorkOS's own. */
export interface WorkOsMirrorUser {
  readonly id: string;
  readonly email: string;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly avatarUrl: string | null;
  readonly lastSignInAt: Date | null;
  readonly updatedAt: Date;
}

/**
 * A WorkOS organization membership, as the mirror stores it. `id` is the
 * WorkOS `om_…`; `accountId` the WorkOS user id; `updatedAt` is WorkOS's own.
 * The organization row must already be mirrored (`upsertOrganization`) — a
 * membership of an unknown org is a `query` failure, not a silent skip.
 */
export interface WorkOsMirrorMembership {
  readonly id: string;
  readonly accountId: string;
  readonly organizationId: string;
  readonly role: string;
  readonly status: MemberStatus;
  readonly updatedAt: Date;
}

/**
 * What identifies a membership to a delete: the WorkOS `om_…` id AND the
 * (account, organization) pair it belongs to. The pair is the row's key,
 * and a delete must be able to mint the row as a tombstone when the mirror
 * has not seen the membership yet — an id alone cannot.
 */
export type WorkOsMirrorMembershipRef = Pick<
  WorkOsMirrorMembership,
  "id" | "accountId" | "organizationId"
>;

/**
 * The public failure of every mirror write: which call, and how it failed
 * (classified from the driver cause the same way `UserStoreError` is).
 */
export class WorkOsMirrorError extends Schema.TaggedErrorClass<WorkOsMirrorError>()(
  "WorkOsMirrorError",
  {
    operation: Schema.String,
    reason: Schema.Literals(USER_STORE_FAILURE_REASONS),
  },
  { httpApiStatus: 500 },
) {
  override get message(): string {
    return `workos mirror ${this.operation} failed: ${this.reason}`;
  }
}

export interface WorkOsMirrorShape {
  /**
   * Insert or refresh a user row. `false` when the payload was refused and
   * the row left untouched: the stored row is newer than `updatedAt`, or is
   * a deletion tombstone stamped at `updatedAt` or later.
   */
  readonly upsertUser: (user: WorkOsMirrorUser) => Effect.Effect<boolean, WorkOsMirrorError>;
  /**
   * Insert or refresh a membership row, minting the bare account row first so
   * the foreign key holds when the membership arrives before its user. `false`
   * when the payload was refused: the stored row is newer than `updatedAt`,
   * or is a tombstone stamped at `updatedAt` or later — or the membership id
   * is recorded in the deletion ledger (`membership_tombstones`, written by
   * `deleteMembership`), whatever the payload is stamped: WorkOS never
   * reuses a deleted `om_…` id, so no payload naming a recorded id is
   * current — or the account is a deletion tombstone (`deleteUser`),
   * whatever the payload is stamped: WorkOS never reuses a user id either,
   * so a deleted user has no memberships to mirror.
   */
  readonly upsertMembership: (
    membership: WorkOsMirrorMembership,
  ) => Effect.Effect<boolean, WorkOsMirrorError>;
  /**
   * Tombstone the membership as deleted: the row stays (or is minted, when
   * the mirror has not seen the membership yet), `inactive`, carrying the
   * deleted WorkOS id and stamped so that only a payload newer than the
   * stamp can reactivate the row. The stamp is on WorkOS's clock, so it
   * orders against every payload the mirror is fed: `deletedAt` is an
   * instant at or after the membership's last reported state — a deletion
   * event's `createdAt`, or the `updatedAt` WorkOS last reported for the
   * membership when Executor deletes it (WorkOS answers a delete with no
   * time) — or `null` when the caller holds no WorkOS instant at all: the
   * row then keeps the stamp it holds, the last state WorkOS reported for
   * this membership. Never a local clock: read after WorkOS answered, it
   * can post-date a replacement membership WorkOS created for the same
   * member meanwhile, and a tombstone stamped with it would refuse that
   * replacement for good. Every payload of the deleted membership a feeder
   * could have fetched is at or before the stamp (a tombstone wins a tie),
   * and every replacement is after it. A row the mirror does not hold and
   * no instant to stamp it with takes the current time: there is no WorkOS
   * stamp to keep. Matches the row by the membership's IDENTITY, never by
   * timestamp: `false` when the row already carries this tombstone or a
   * later one (a replayed delete), or holds ANOTHER membership id — the
   * member re-added in WorkOS under a new id, which stands whether the
   * replacement was mirrored before or after this delete was stamped. In
   * EVERY case the deleted id is recorded in the deletion ledger
   * (`membership_tombstones`) — a row holding another id is left alone, but
   * the id this delete names is still refused to every later write, so a
   * membership the mirror never held under its own id (replaced and deleted
   * in WorkOS before the mirror saw it) cannot be inserted live by a scan
   * that listed it before the deletion. `true` when the delete changed
   * anything: the row was tombstoned, or the id was newly recorded. The
   * organization row must already be mirrored, as for `upsertMembership`.
   */
  readonly deleteMembership: (
    membership: WorkOsMirrorMembershipRef,
    deletedAt: Date | null,
  ) => Effect.Effect<boolean, WorkOsMirrorError>;
  /**
   * Tombstone a deleted WorkOS user: every membership of the account is
   * tombstoned as by `deleteMembership`, and the account row is kept (it
   * anchors foreign keys) — or minted, when the mirror has not seen the user
   * yet — with its profile cleared and stamped `deletedAt`, so a stale user
   * payload cannot restore it. `false` when the account already carries
   * this tombstone or a later one (a replayed delete).
   */
  readonly deleteUser: (
    accountId: string,
    deletedAt: Date,
  ) => Effect.Effect<boolean, WorkOsMirrorError>;
  /** The id of the last WorkOS event applied, or `null` before the first run. */
  readonly getCursor: () => Effect.Effect<string | null, WorkOsMirrorError>;
  /**
   * Compare-and-set the cursor: advance to `next` only if it still reads
   * `prev` (`null` = no cursor yet). `false` means another run moved it first
   * — the caller must stop, it no longer owns the stream.
   */
  readonly setCursor: (
    prev: string | null,
    next: string,
  ) => Effect.Effect<boolean, WorkOsMirrorError>;
}

// The one events stream the reconciler follows. A row id rather than a
// singleton table so a second stream (another WorkOS environment, a replay)
// can be added without a schema change.
const EVENTS_CURSOR_ID = "events";

// A tombstone keeps the row, marks it `inactive`, and moves its timestamp to
// the deletion time — never backwards, so a row that somehow carries a newer
// WorkOS timestamp keeps it and the upsert guard stays at least as strict.
// With no instant at all (`deletedAt` null, see `deleteMembership`) the row
// keeps the stamp it holds, and a row that has none takes the current time
// — the only instant known. (A raw `sql`
// fragment binds the Date without the column's driver mapping, so it is
// passed as ISO text and cast.)
const noEarlierThan = (column: AnyPgColumn, at: Date | null) =>
  at === null
    ? sql`coalesce(${column}, now())`
    : sql`greatest(${column}, ${at.toISOString()}::timestamptz)`;

const tombstone = (deletedAt: Date | null) => ({
  status: "inactive" as const,
  workosUpdatedAt: noEarlierThan(memberships.workosUpdatedAt, deletedAt),
});

// Which stored membership rows a payload stamped `updatedAt` may overwrite:
// a row with no stamp (predating the mirror), any row stamped earlier, and a
// LIVE row stamped the same instant — feeders replay the same payload and
// must converge, not stall. An `inactive` row stamped the same instant is
// not overwritten: a deletion (or deactivation) at T beats an active payload
// at T, so an equal-timestamp payload can never undo a tombstone.
const membershipAcceptsPayload = (updatedAt: Date) =>
  or(
    isNull(memberships.workosUpdatedAt),
    lt(memberships.workosUpdatedAt, updatedAt),
    and(eq(memberships.workosUpdatedAt, updatedAt), ne(memberships.status, "inactive")),
  );

// A deleted user's account row, as `deleteUser` leaves it: the profile is
// cleared (every WorkOS user payload carries an email, so a stamped row with
// none was written by `deleteUser`) and the stamp is the deletion time. A row
// minted bare by `ensureAccount` has no stamp either, and is not a tombstone.
const accountIsTombstone = and(isNull(accounts.email), isNotNull(accounts.workosUpdatedAt));

// Whether membership `id` is in the deletion ledger: a WorkOS id a delete
// has named, which never returns. Judged by identity alone — the ledger
// records WHEN for the record, not for ordering.
const membershipIdDeleted = async (db: DrizzleDb, id: string): Promise<boolean> => {
  const rows = await db
    .select({ membershipId: membershipTombstones.membershipId })
    .from(membershipTombstones)
    .where(eq(membershipTombstones.membershipId, id));
  return rows.length > 0;
};

// The same rule as for a membership row, for an account row. A tombstone
// takes no payload stamped at or before the deletion; a bare row takes any.
const accountAcceptsPayload = (updatedAt: Date) =>
  or(
    isNull(accounts.workosUpdatedAt),
    lt(accounts.workosUpdatedAt, updatedAt),
    and(eq(accounts.workosUpdatedAt, updatedAt), isNotNull(accounts.email)),
  );

// A delete is applied unless the row already carries this tombstone or a
// later one: a replayed deletion changes nothing and reports so. With no
// instant given, any tombstone the row carries is this one or later.
const notTombstonedSince = (deletedAt: Date | null) =>
  or(
    ne(memberships.status, "inactive"),
    isNull(memberships.workosUpdatedAt),
    deletedAt === null ? undefined : lt(memberships.workosUpdatedAt, deletedAt),
  );

// Which (account, organization) row a delete of membership `id` at
// `deletedAt` may tombstone: the row carrying THIS id — whatever its stamp,
// a deleted id is never reused — or a row with no id at all (written before
// the mirror recorded WorkOS ids; the delete fills the id in). Never a row
// under ANOTHER id: that is a different membership of the same account and
// organization, the member re-added in WorkOS after this one was removed,
// and it stands however the two are stamped. Its stamp cannot be trusted to
// order them: a removal Executor makes is stamped by a local clock, and one
// that reads the clock after WorkOS answered can post-date a replacement
// WorkOS created while the request was in flight. Identity orders them,
// timestamps do not. A row already carrying this tombstone or a later one is
// left alone (`notTombstonedSince`) so a replayed delete reports `false`.
const membershipDeletableBy = (id: string, deletedAt: Date | null) =>
  and(
    or(isNull(memberships.membershipId), eq(memberships.membershipId, id)),
    notTombstonedSince(deletedAt),
  );

const makeService = (db: DrizzleDb): WorkOsMirrorShape => {
  const run = <A>(op: string, fn: () => Promise<A>) =>
    withServiceLogging(
      `workos_mirror.${op}`,
      (failure) =>
        new WorkOsMirrorError({
          operation: op,
          reason: userStoreReasonFromCause(failure),
        }),
      tryPromiseService(fn),
    );

  // Over `db` or a transaction handle (drizzle's is a `PgDatabase` too).
  const ensureAccount = (on: DrizzleDb, id: string) =>
    on.insert(accounts).values({ id }).onConflictDoNothing({ target: accounts.id });

  return {
    upsertUser: (user) =>
      run("upsertUser", async () => {
        const written = await db
          .insert(accounts)
          .values({
            id: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            avatarUrl: user.avatarUrl,
            lastSignInAt: user.lastSignInAt,
            workosUpdatedAt: user.updatedAt,
          })
          .onConflictDoUpdate({
            target: accounts.id,
            set: {
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              avatarUrl: user.avatarUrl,
              lastSignInAt: user.lastSignInAt,
              workosUpdatedAt: user.updatedAt,
            },
            setWhere: accountAcceptsPayload(user.updatedAt),
          })
          .returning({ id: accounts.id });
        return written.length > 0;
      }),

    upsertMembership: (membership) =>
      run("upsertMembership", async () => {
        await ensureAccount(db, membership.accountId);
        // Never for a DELETED user. The row guard below orders a payload
        // against the membership row it would overwrite; a membership the
        // mirror has not seen yet has no row, so the guard cannot refuse
        // the INSERT — and a feeder that fetched the membership before the
        // user was deleted and writes it after (a stalled login list, the
        // backfill's older listing) would insert it live. The account
        // tombstone is the one row a deleted user always leaves behind, so
        // it is consulted first, by identity: WorkOS never reuses a user
        // id, so no payload naming a tombstoned account is ever current.
        const deleted = await db
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.id, membership.accountId), accountIsTombstone));
        if (deleted.length > 0) return false;
        // Never under a DELETED membership id. The row guard below can only
        // refuse against the id the row holds; a delete of THIS id that
        // found the row under another id (see the header) left only the
        // ledger entry behind, and that is what refuses the payload here.
        if (await membershipIdDeleted(db, membership.id)) return false;
        const written = await db
          .insert(memberships)
          .values({
            accountId: membership.accountId,
            organizationId: membership.organizationId,
            membershipId: membership.id,
            role: membership.role,
            status: membership.status,
            workosUpdatedAt: membership.updatedAt,
          })
          .onConflictDoUpdate({
            target: [memberships.accountId, memberships.organizationId],
            set: {
              membershipId: membership.id,
              role: membership.role,
              status: membership.status,
              workosUpdatedAt: membership.updatedAt,
            },
            setWhere: membershipAcceptsPayload(membership.updatedAt),
          })
          .returning({ accountId: memberships.accountId });
        return written.length > 0;
      }),

    // An upsert, like the membership write it guards against: a delete the
    // mirror sees before the membership itself (the reconciler ahead of the
    // backfill) must leave the tombstone behind, or the later, older payload
    // would insert the row live.
    deleteMembership: (membership, deletedAt) =>
      run("deleteMembership", () =>
        db.transaction(async (tx) => {
          await ensureAccount(tx, membership.accountId);
          // The ledger entry FIRST, whatever the row holds: this is the one
          // record of the deletion that does not depend on the row carrying
          // the deleted id. A replayed delete finds it there (`DO NOTHING`)
          // and records nothing new.
          const recorded = await tx
            .insert(membershipTombstones)
            .values({
              membershipId: membership.id,
              accountId: membership.accountId,
              organizationId: membership.organizationId,
              ...(deletedAt === null ? {} : { deletedAt }),
            })
            .onConflictDoNothing({ target: membershipTombstones.membershipId })
            .returning({ membershipId: membershipTombstones.membershipId });
          const tombstoned = await tx
            .insert(memberships)
            .values({
              accountId: membership.accountId,
              organizationId: membership.organizationId,
              membershipId: membership.id,
              status: "inactive",
              workosUpdatedAt: deletedAt ?? new Date(),
            })
            .onConflictDoUpdate({
              target: [memberships.accountId, memberships.organizationId],
              set: { membershipId: membership.id, ...tombstone(deletedAt) },
              setWhere: membershipDeletableBy(membership.id, deletedAt),
            })
            .returning({ accountId: memberships.accountId });
          return recorded.length > 0 || tombstoned.length > 0;
        }),
      ),

    deleteUser: (accountId, deletedAt) =>
      run("deleteUser", async () => {
        // The account tombstone FIRST, then the memberships. A membership
        // write checks the account tombstone before it inserts
        // (`upsertMembership`), so a write racing this delete either sees
        // the tombstone and refuses, or has landed before it and is caught
        // by the membership tombstoning below. In the other order a write
        // between the two statements would slip through live.
        //
        // The account tombstone: profile cleared, stamped with the deletion.
        // Minted when absent, for the same reason as the membership one.
        const cleared = await db
          .insert(accounts)
          .values({ id: accountId, workosUpdatedAt: deletedAt })
          .onConflictDoUpdate({
            target: accounts.id,
            set: {
              email: null,
              firstName: null,
              lastName: null,
              avatarUrl: null,
              workosUpdatedAt: noEarlierThan(accounts.workosUpdatedAt, deletedAt),
            },
            // Applied unless the row already carries this tombstone or a
            // later one (a replayed delete).
            setWhere: or(
              isNotNull(accounts.email),
              isNull(accounts.workosUpdatedAt),
              lt(accounts.workosUpdatedAt, deletedAt),
            ),
          })
          .returning({ id: accounts.id });
        await db
          .update(memberships)
          .set(tombstone(deletedAt))
          .where(and(eq(memberships.accountId, accountId), notTombstonedSince(deletedAt)));
        return cleared.length > 0;
      }),

    getCursor: () =>
      run("getCursor", async () => {
        const rows = await db
          .select({ cursor: workosSync.cursor })
          .from(workosSync)
          .where(eq(workosSync.id, EVENTS_CURSOR_ID));
        // No row yet is the same state as a row with no cursor: nothing applied.
        return rows[0]?.cursor ?? null;
      }),

    setCursor: (prev, next) =>
      run("setCursor", async () => {
        const now = new Date();
        if (prev === null) {
          // First advance: mint the row, or claim an existing row that still
          // has no cursor. A row that already carries one belongs to another
          // run and is left alone.
          const written = await db
            .insert(workosSync)
            .values({ id: EVENTS_CURSOR_ID, cursor: next, updatedAt: now })
            .onConflictDoUpdate({
              target: workosSync.id,
              set: { cursor: next, updatedAt: now },
              setWhere: isNull(workosSync.cursor),
            })
            .returning({ id: workosSync.id });
          return written.length > 0;
        }
        const written = await db
          .update(workosSync)
          .set({ cursor: next, updatedAt: now })
          .where(and(eq(workosSync.id, EVENTS_CURSOR_ID), eq(workosSync.cursor, prev)))
          .returning({ id: workosSync.id });
        return written.length > 0;
      }),
  };
};

export class WorkOsMirror extends Context.Service<WorkOsMirror, WorkOsMirrorShape>()(
  "@executor-js/cloud/WorkOsMirror",
) {
  static Live = Layer.effect(this)(Effect.map(DbService.asEffect(), ({ db }) => makeService(db)));
}

/**
 * A FRESH `WorkOsMirror` layer (new layer value per call), for a service built
 * once but invoked across many Workers requests — the same reason
 * `makeUserStoreLayer` exists. See [[makeDbLayer]].
 */
export const makeWorkOsMirrorLayer = (): Layer.Layer<WorkOsMirror, never, DbService> =>
  Layer.effect(WorkOsMirror)(Effect.map(DbService.asEffect(), ({ db }) => makeService(db)));
