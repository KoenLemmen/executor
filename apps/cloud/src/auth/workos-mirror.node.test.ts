// ---------------------------------------------------------------------------
// The cloud membership mirror: `WorkOsMirror` (writes) + the cloud
// `MemberDirectory` (reads), against the real PGlite Postgres every cloud
// unit test runs on (scripts/test-globalsetup.ts), through the same
// `DbService.Live` the request path uses.
//
// What this pins:
//   - an older WorkOS payload never overwrites a newer row (replay-safe)
//   - a delete tombstones the row (inactive, stamped with the deletion time):
//     a stale OR equal-timestamp upsert cannot resurrect it, a newer one
//     reactivates it, and every default read treats the tombstone as no
//     membership
//   - a delete of a membership or user the mirror has not seen yet leaves
//     the tombstone behind, so the backfill's older payload cannot insert
//     the row live afterwards
//   - a delete of a membership id the row does NOT hold (the member's row
//     still carries the id it was replaced from) is recorded all the same,
//     so a later, newer payload of the deleted id cannot take the row over
//   - a deleted user takes no membership at all, however the payload is
//     stamped: the account tombstone refuses the insert by identity
//   - a delete with no WorkOS instant keeps the row's own WorkOS stamp, so
//     a replacement membership WorkOS created meanwhile is not refused,
//     while the removed membership's own payload still is
//   - the cursor advances only by compare-and-set (one owner per stream)
//   - `members` searches email AND name case-insensitively, pages stably
//   - `findByEmail` ignores the casing WorkOS stored
//   - a membership arriving before its user still holds (FK via ensureAccount)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { MemberDirectory } from "@executor-js/api/server";

import { DbService } from "../db/db";
import { cloudMemberDirectoryLayer } from "./member-directory";
import { UserStoreService } from "./context";
import { WorkOsMirror, type WorkOsMirrorMembership, type WorkOsMirrorUser } from "./workos-mirror";

const DbLive = DbService.Live;
const Services = Layer.mergeAll(
  WorkOsMirror.Live,
  cloudMemberDirectoryLayer,
  UserStoreService.Live,
).pipe(Layer.provideMerge(DbLive));

const run = <A, E>(body: Effect.Effect<A, E, WorkOsMirror | MemberDirectory | UserStoreService>) =>
  Effect.runPromise(body.pipe(Effect.provide(Services), Effect.scoped));

const at = (iso: string) => new Date(iso);
const T1 = at("2026-01-01T00:00:00.000Z");
const T2 = at("2026-01-02T00:00:00.000Z");
const T3 = at("2026-01-03T00:00:00.000Z");
const T4 = at("2026-01-04T00:00:00.000Z");

// Every test mints its own org so the shared test database never couples
// them; ids are synthetic placeholders, never real identities.
const freshOrg = () =>
  Effect.gen(function* () {
    const id = `org_${crypto.randomUUID().replaceAll("-", "")}`;
    const store = yield* UserStoreService;
    yield* store.use("upsertOrganization", (s) => s.upsertOrganization({ id, name: "Mirror Org" }));
    return id;
  });

const user = (id: string, overrides: Partial<WorkOsMirrorUser> = {}): WorkOsMirrorUser => ({
  id,
  email: `${id}@placeholder.test`,
  firstName: null,
  lastName: null,
  avatarUrl: null,
  lastSignInAt: null,
  updatedAt: T1,
  ...overrides,
});

const membership = (
  organizationId: string,
  accountId: string,
  overrides: Partial<WorkOsMirrorMembership> = {},
): WorkOsMirrorMembership => ({
  id: `om_${accountId}_${organizationId}`,
  accountId,
  organizationId,
  role: "member",
  status: "active",
  updatedAt: T1,
  ...overrides,
});

describe("WorkOsMirror upserts", () => {
  it("ignores a user payload older than the stored row, accepts a newer one", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        yield* mirror.upsertMembership(membership(org, id));

        const first = yield* mirror.upsertUser(user(id, { firstName: "Ada", updatedAt: T2 }));
        const stale = yield* mirror.upsertUser(user(id, { firstName: "Stale", updatedAt: T1 }));
        const afterStale = yield* directory.membership(id, org);
        const newer = yield* mirror.upsertUser(user(id, { firstName: "Newer", updatedAt: T3 }));
        const afterNewer = yield* directory.membership(id, org);
        return { first, stale, newer, afterStale, afterNewer };
      }),
    );
    expect(result.first).toBe(true);
    expect(result.stale, "an older payload is reported as not written").toBe(false);
    expect(result.afterStale?.name, "and left the newer row untouched").toBe("Ada");
    expect(result.newer).toBe(true);
    expect(result.afterNewer?.name).toBe("Newer");
  });

  it("ignores a membership payload older than the stored row", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        yield* mirror.upsertUser(user(id));
        yield* mirror.upsertMembership(membership(org, id, { role: "admin", updatedAt: T2 }));
        const stale = yield* mirror.upsertMembership(
          membership(org, id, {
            role: "member",
            status: "inactive",
            updatedAt: T1,
          }),
        );
        const row = yield* directory.membership(id, org);
        const equal = yield* mirror.upsertMembership(
          membership(org, id, { role: "member", updatedAt: T2 }),
        );
        const afterEqual = yield* directory.membership(id, org);
        return { stale, row, equal, afterEqual };
      }),
    );
    expect(result.stale).toBe(false);
    expect(result.row?.role).toBe("admin");
    expect(result.row?.status).toBe("active");
    // Equal timestamps are accepted: the feeders replay the same payload and
    // must converge, not stall.
    expect(result.equal).toBe(true);
    expect(result.afterEqual?.role).toBe("member");
  });

  it("mints the account row when a membership arrives before its user", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        const written = yield* mirror.upsertMembership(membership(org, id));
        const bare = yield* directory.membership(id, org);
        // The bare row has no timestamp, so the first user payload — even an
        // "old" one — fills it.
        yield* mirror.upsertUser(user(id, { firstName: "Late", updatedAt: T1 }));
        const filled = yield* directory.membership(id, org);
        return { written, bare, filled };
      }),
    );
    expect(result.written).toBe(true);
    expect(result.bare).not.toBeNull();
    expect(result.bare?.email).toBeNull();
    expect(result.filled?.name).toBe("Late");
  });

  it("tombstones a deleted membership so a stale upsert cannot resurrect it, and a newer one can", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        const membershipId = `om_${id}_${org}`;
        yield* mirror.upsertUser(user(id));
        yield* mirror.upsertMembership(membership(org, id, { id: membershipId, updatedAt: T1 }));

        const ref = { id: membershipId, accountId: id, organizationId: org };
        const removed = yield* mirror.deleteMembership(ref, T2);
        const removedAgain = yield* mirror.deleteMembership(ref, T2);
        const byDefault = yield* directory.membership(id, org);
        const listed = yield* directory.members(org);
        const asInactive = yield* directory.membership(id, org, ["inactive"]);

        // A feeder that fetched the membership BEFORE the deletion (login,
        // backfill) writes it after: the guard refuses it.
        const stale = yield* mirror.upsertMembership(
          membership(org, id, { id: membershipId, updatedAt: T1 }),
        );
        const afterStale = yield* directory.membership(id, org, ["inactive"]);
        // An active payload stamped the SAME instant as the deletion: the
        // tombstone wins, a deletion at T is never undone by a payload at T.
        const equal = yield* mirror.upsertMembership(
          membership(org, id, { id: membershipId, updatedAt: T2 }),
        );
        const afterEqual = yield* directory.membership(id, org, ["inactive"]);
        // The member re-added in WorkOS: a payload newer than the deletion,
        // under a new membership id (a deleted id is never reused).
        const readded = yield* mirror.upsertMembership(
          membership(org, id, { id: `${membershipId}_2`, updatedAt: T3 }),
        );
        const afterReadd = yield* directory.membership(id, org);
        // The OLD membership's deletion, replayed after the re-add: the
        // newer row, under its new id, stands.
        const lateDelete = yield* mirror.deleteMembership(ref, T2);
        const afterLateDelete = yield* directory.membership(id, org);
        // The same deletion stamped AFTER the replacement (a removal Executor
        // made whose clock was read once WorkOS had answered, by which time
        // the member had been re-added): the row is another membership, so
        // the timestamp does not make it deletable.
        const lateDeleteNewerStamp = yield* mirror.deleteMembership(ref, T4);
        const afterLateDeleteNewerStamp = yield* directory.membership(id, org);
        return {
          removed,
          removedAgain,
          byDefault,
          listed,
          asInactive,
          stale,
          afterStale,
          equal,
          afterEqual,
          readded,
          afterReadd,
          lateDelete,
          afterLateDelete,
          lateDeleteNewerStamp,
          afterLateDeleteNewerStamp,
        };
      }),
    );
    expect(result.removed).toBe(true);
    expect(result.removedAgain, "a replayed delete changes nothing").toBe(false);
    expect(result.byDefault, "a tombstone reads as no membership").toBeNull();
    expect(result.listed, "and is not listed").toEqual([]);
    expect(result.asInactive, "but is still there when asked for").toMatchObject({
      status: "inactive",
      lastActiveAt: null,
    });
    expect(result.stale, "an upsert older than the deletion is refused").toBe(false);
    expect(result.afterStale?.status).toBe("inactive");
    expect(result.equal, "an upsert stamped AT the deletion is refused too").toBe(false);
    expect(result.afterEqual?.status).toBe("inactive");
    expect(result.readded, "an upsert newer than the deletion reactivates").toBe(true);
    expect(result.afterReadd?.status).toBe("active");
    expect(result.lateDelete, "a replayed deletion of the OLD id is refused").toBe(false);
    expect(result.afterLateDelete?.status).toBe("active");
    expect(
      result.lateDeleteNewerStamp,
      "a deletion of the OLD id stamped after the replacement is refused too: identity, not time",
    ).toBe(false);
    expect(result.afterLateDeleteNewerStamp).toMatchObject({
      status: "active",
      membershipId: `om_${result.afterLateDeleteNewerStamp?.accountId}_${result.afterLateDeleteNewerStamp?.organizationId}_2`,
    });
  });

  it("keeps the row's own WorkOS stamp on a delete with no instant, so a replacement created meanwhile is accepted and the removed payload is not", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        const membershipId = `om_${id}_${org}`;
        const ref = { id: membershipId, accountId: id, organizationId: org };
        yield* mirror.upsertUser(user(id));
        yield* mirror.upsertMembership(membership(org, id, { id: membershipId, updatedAt: T1 }));

        // Executor removes the member holding no WorkOS instant for it, so
        // the tombstone keeps T1, the last state WorkOS reported for it —
        // never the local clock, which is long past T2 here.
        const removed = yield* mirror.deleteMembership(ref, null);
        const removedAgain = yield* mirror.deleteMembership(ref, null);
        const tombstone = yield* directory.membership(id, org, ["inactive"]);
        // A login that fetched the membership before the removal: refused.
        const stale = yield* mirror.upsertMembership(
          membership(org, id, { id: membershipId, updatedAt: T1 }),
        );
        // The member re-added in WorkOS while the removal was in flight,
        // under a new id and stamped before any local clock could have
        // stamped the tombstone: accepted.
        const replaced = yield* mirror.upsertMembership(
          membership(org, id, { id: `${membershipId}_2`, updatedAt: T2 }),
        );
        const afterReplace = yield* directory.membership(id, org);
        // A tombstone minted for a row the mirror never held has no stamp
        // to keep; it is still a tombstone.
        const other = `user_${crypto.randomUUID()}`;
        const minted = yield* mirror.deleteMembership(
          { id: `om_${other}_${org}`, accountId: other, organizationId: org },
          null,
        );
        const mintedRow = yield* directory.membership(other, org, ["inactive"]);
        return {
          membershipId,
          removed,
          removedAgain,
          tombstone,
          stale,
          replaced,
          afterReplace,
          minted,
          mintedRow,
        };
      }),
    );
    expect(result.removed).toBe(true);
    expect(result.removedAgain, "a repeated removal changes nothing").toBe(false);
    expect(result.tombstone?.status).toBe("inactive");
    expect(result.stale, "the pre-removal payload is refused").toBe(false);
    expect(result.replaced, "a replacement newer than the row's stamp is accepted").toBe(true);
    expect(result.afterReplace).toMatchObject({
      status: "active",
      membershipId: `${result.membershipId}_2`,
    });
    expect(result.minted, "a row the mirror never held is still tombstoned").toBe(true);
    expect(result.mintedRow?.status).toBe("inactive");
  });

  it("tombstones a membership the mirror has not seen, so a later older payload cannot insert it live", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        const membershipId = `om_${id}_${org}`;
        const readdedId = `${membershipId}_2`;
        const ref = { id: membershipId, accountId: id, organizationId: org };

        // The reconciler applies the deletion before the backfill has
        // inserted the row (the user is unknown too).
        const removed = yield* mirror.deleteMembership(ref, T2);
        const removedAgain = yield* mirror.deleteMembership(ref, T2);
        const tombstone = yield* directory.membership(id, org, ["inactive"]);
        // The backfill, listing WorkOS as it was before the deletion, now
        // writes the membership: refused, the tombstone stands.
        const backfilled = yield* mirror.upsertMembership(
          membership(org, id, { id: membershipId, updatedAt: T1 }),
        );
        const afterBackfill = yield* directory.membership(id, org);
        // The user payload still fills the bare account row the tombstone
        // minted, so the inactive row reads with its profile.
        yield* mirror.upsertUser(user(id, { firstName: "Late", updatedAt: T1 }));
        const profiled = yield* directory.membership(id, org, ["inactive"]);
        // Re-added in WorkOS later under a NEW membership id.
        const readded = yield* mirror.upsertMembership(
          membership(org, id, { id: readdedId, updatedAt: T3 }),
        );
        const afterReadd = yield* directory.membership(id, org);
        return {
          readdedId,
          removed,
          removedAgain,
          tombstone,
          backfilled,
          afterBackfill,
          profiled,
          readded,
          afterReadd,
        };
      }),
    );
    expect(result.removed, "the delete leaves a tombstone behind").toBe(true);
    expect(result.removedAgain).toBe(false);
    expect(result.tombstone).toMatchObject({ status: "inactive", email: null });
    expect(result.backfilled, "the pre-deletion payload is refused").toBe(false);
    expect(result.afterBackfill, "and the member is not live").toBeNull();
    expect(result.profiled?.name).toBe("Late");
    expect(result.readded).toBe(true);
    expect(result.afterReadd).toMatchObject({
      status: "active",
      membershipId: result.readdedId,
    });
  });

  it("records a delete whose id the row does not hold, so a newer payload of that id cannot take the row over", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        const membershipA = `om_${id}_${org}_a`;
        const membershipB = `om_${id}_${org}_b`;
        yield* mirror.upsertUser(user(id));
        // The mirror holds A (a stale listing). In WorkOS, A was already
        // replaced by B (stamped T2), and B is then deleted (T3) before any
        // feeder wrote B here.
        yield* mirror.upsertMembership(membership(org, id, { id: membershipA, updatedAt: T1 }));
        const refB = { id: membershipB, accountId: id, organizationId: org };
        const deletedB = yield* mirror.deleteMembership(refB, T3);
        const deletedBAgain = yield* mirror.deleteMembership(refB, T3);
        const rowAfterDelete = yield* directory.membership(id, org);
        // A delayed scan, listed before B's deletion, now writes B: stamped
        // after A and under another id, exactly what the row guard lets
        // through — the ledger refuses it.
        const lateB = yield* mirror.upsertMembership(
          membership(org, id, { id: membershipB, updatedAt: T2 }),
        );
        const afterLateB = yield* directory.membership(id, org);
        // A's own deletion, applied later, tombstones the row it holds.
        const deletedA = yield* mirror.deleteMembership(
          { id: membershipA, accountId: id, organizationId: org },
          T3,
        );
        const afterDeleteA = yield* directory.membership(id, org);
        // The member re-added in WorkOS under a third id: accepted.
        const readded = yield* mirror.upsertMembership(
          membership(org, id, { id: `${membershipB}_c`, updatedAt: T4 }),
        );
        const afterReadd = yield* directory.membership(id, org);
        return {
          deletedB,
          deletedBAgain,
          rowAfterDelete,
          lateB,
          afterLateB,
          deletedA,
          afterDeleteA,
          readded,
          afterReadd,
          membershipA,
        };
      }),
    );
    expect(result.deletedB, "the delete is recorded even though the row holds another id").toBe(
      true,
    );
    expect(result.deletedBAgain, "a replayed delete records nothing new").toBe(false);
    expect(
      result.rowAfterDelete?.membershipId,
      "the row under A is not B's to tombstone and stands",
    ).toBe(result.membershipA);
    expect(result.lateB, "the newer payload of the deleted id is refused: identity, not time").toBe(
      false,
    );
    expect(result.afterLateB?.membershipId).toBe(result.membershipA);
    expect(result.deletedA).toBe(true);
    expect(result.afterDeleteA, "A's deletion tombstones the row").toBeNull();
    expect(result.readded, "a replacement under a fresh id reactivates").toBe(true);
    expect(result.afterReadd?.status).toBe("active");
  });

  it("tombstones every membership of a deleted user and clears the profile, keeping the account row", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        const directory = yield* MemberDirectory;
        const orgA = yield* freshOrg();
        const orgB = yield* freshOrg();
        const id = `user_${crypto.randomUUID()}`;
        yield* mirror.upsertUser(user(id, { firstName: "Gone", updatedAt: T1 }));
        yield* mirror.upsertMembership(membership(orgA, id));
        yield* mirror.upsertMembership(membership(orgB, id));

        const deleted = yield* mirror.deleteUser(id, T2);
        const deletedAgain = yield* mirror.deleteUser(id, T2);
        const inA = yield* directory.membership(id, orgA);
        const inB = yield* directory.membership(id, orgB, ["inactive"]);
        // A stale user payload cannot restore the profile, nor can one
        // stamped at the deletion itself. No membership of the deleted user
        // is written again — not one stamped after the deletion under a new
        // id, the payload a timestamp guard would let through: the user is
        // gone, and WorkOS never reuses the id.
        const staleUser = yield* mirror.upsertUser(user(id, { firstName: "Back", updatedAt: T1 }));
        const equalUser = yield* mirror.upsertUser(user(id, { firstName: "Same", updatedAt: T2 }));
        const rejoined = yield* mirror.upsertMembership(
          membership(orgA, id, { id: `om_${id}_${orgA}_2`, updatedAt: T3 }),
        );
        const afterRejoin = yield* directory.membership(id, orgA, ["inactive"]);
        // A user the mirror has never seen: the delete mints the account
        // tombstone, the backfill's older profile cannot fill it afterwards,
        // and a membership of the user the mirror has never seen — no row
        // for the membership guard to judge — is refused by the account
        // tombstone alone, whatever it is stamped.
        const unseen = `user_${crypto.randomUUID()}`;
        const unknown = yield* mirror.deleteUser(unseen, T2);
        const unseenProfile = yield* mirror.upsertUser(
          user(unseen, { firstName: "Ghost", updatedAt: T1 }),
        );
        const unseenMembership = yield* mirror.upsertMembership(
          membership(orgA, unseen, { updatedAt: T3 }),
        );
        const unseenRow = yield* directory.membership(unseen, orgA, [
          "active",
          "pending",
          "inactive",
        ]);
        return {
          deleted,
          deletedAgain,
          inA,
          inB,
          staleUser,
          equalUser,
          rejoined,
          afterRejoin,
          unknown,
          unseenProfile,
          unseenMembership,
          unseenRow,
        };
      }),
    );
    expect(result.deleted).toBe(true);
    expect(result.deletedAgain, "a replayed delete changes nothing").toBe(false);
    expect(result.inA, "the user's memberships are tombstoned").toBeNull();
    expect(result.inB).toMatchObject({
      status: "inactive",
      email: null,
      name: null,
    });
    expect(result.staleUser).toBe(false);
    expect(result.equalUser, "a profile stamped AT the deletion is refused").toBe(false);
    expect(
      result.rejoined,
      "a membership of a deleted user is refused however it is stamped: identity, not time",
    ).toBe(false);
    expect(result.afterRejoin).toMatchObject({
      status: "inactive",
      name: null,
    });
    expect(result.unknown, "deleting an unseen user leaves a tombstone").toBe(true);
    expect(result.unseenProfile, "which the older profile cannot fill").toBe(false);
    expect(
      result.unseenMembership,
      "and a membership the mirror never held is not inserted for the deleted user",
    ).toBe(false);
    expect(result.unseenRow).toBeNull();
  });
});

describe("WorkOsMirror cursor", () => {
  it("advances only by compare-and-set", async () => {
    const result = await run(
      Effect.gen(function* () {
        const mirror = yield* WorkOsMirror;
        // The cursor is instance-wide; read whatever a previous test left so
        // this test's expectations are relative, not absolute.
        const before = yield* mirror.getCursor();
        const first = yield* mirror.setCursor(before, "event_1");
        const wrongPrev = yield* mirror.setCursor(before === null ? "event_0" : null, "event_x");
        const afterWrong = yield* mirror.getCursor();
        const right = yield* mirror.setCursor("event_1", "event_2");
        const after = yield* mirror.getCursor();
        return { first, wrongPrev, afterWrong, right, after };
      }),
    );
    expect(result.first).toBe(true);
    expect(result.wrongPrev, "a run holding a stale prev cannot move the cursor").toBe(false);
    expect(result.afterWrong).toBe("event_1");
    expect(result.right).toBe(true);
    expect(result.after).toBe("event_2");
  });
});

describe("cloud MemberDirectory", () => {
  const seed = (org: string) =>
    Effect.gen(function* () {
      const mirror = yield* WorkOsMirror;
      const ids = {
        ada: `user_${crypto.randomUUID()}`,
        grace: `user_${crypto.randomUUID()}`,
        linus: `user_${crypto.randomUUID()}`,
        gone: `user_${crypto.randomUUID()}`,
      };
      yield* mirror.upsertUser(
        user(ids.ada, {
          email: "Ada.Lovelace@Placeholder.test",
          firstName: "Ada",
          lastName: "Lovelace",
          lastSignInAt: T2,
        }),
      );
      yield* mirror.upsertUser(
        user(ids.grace, {
          email: "grace@placeholder.test",
          firstName: "Grace",
          lastName: "Hopper",
        }),
      );
      yield* mirror.upsertUser(
        user(ids.linus, {
          email: "linus@placeholder.test",
          firstName: "Linus",
          lastName: null,
        }),
      );
      yield* mirror.upsertUser(user(ids.gone, { email: "gone@placeholder.test" }));
      yield* mirror.upsertMembership(membership(org, ids.ada, { role: "admin" }));
      yield* mirror.upsertMembership(membership(org, ids.grace, { status: "pending" }));
      yield* mirror.upsertMembership(membership(org, ids.linus));
      yield* mirror.upsertMembership(membership(org, ids.gone, { status: "inactive" }));
      return ids;
    });

  it("lists active + pending members by default, ordered by email, and pages stably", async () => {
    const result = await run(
      Effect.gen(function* () {
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const ids = yield* seed(org);
        const all = yield* directory.members(org);
        const page1 = yield* directory.members(org, { limit: 2, offset: 0 });
        const page2 = yield* directory.members(org, { limit: 2, offset: 2 });
        const inactive = yield* directory.members(org, {
          statuses: ["inactive"],
        });
        return { ids, all, page1, page2, inactive };
      }),
    );
    expect(result.all.map((m) => m.email)).toEqual([
      "Ada.Lovelace@Placeholder.test",
      "grace@placeholder.test",
      "linus@placeholder.test",
    ]);
    expect(result.all.find((m) => m.accountId === result.ids.ada)).toMatchObject({
      role: "admin",
      status: "active",
      name: "Ada Lovelace",
      lastActiveAt: T2.getTime(),
    });
    expect(result.all.find((m) => m.accountId === result.ids.linus)?.name).toBe("Linus");
    expect([...result.page1, ...result.page2].map((m) => m.accountId)).toEqual(
      result.all.map((m) => m.accountId),
    );
    expect(result.inactive.map((m) => m.accountId)).toEqual([result.ids.gone]);
  });

  it("searches email and name case-insensitively, escaping LIKE wildcards", async () => {
    const result = await run(
      Effect.gen(function* () {
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const ids = yield* seed(org);
        const byEmail = yield* directory.members(org, { search: "LOVELACE@" });
        const byName = yield* directory.members(org, {
          search: "  grace hop ",
        });
        const nothing = yield* directory.members(org, { search: "nobody" });
        const blank = yield* directory.members(org, { search: "   " });
        const wildcard = yield* directory.members(org, { search: "%" });
        return { ids, byEmail, byName, nothing, blank, wildcard };
      }),
    );
    expect(result.byEmail.map((m) => m.accountId)).toEqual([result.ids.ada]);
    expect(result.byName.map((m) => m.accountId)).toEqual([result.ids.grace]);
    expect(result.nothing).toEqual([]);
    expect(result.blank.length, "a blank term is no filter").toBe(3);
    expect(result.wildcard, "a literal % matches nothing rather than everything").toEqual([]);
  });

  it("resolves a normalized email regardless of stored casing, and batches by id", async () => {
    const result = await run(
      Effect.gen(function* () {
        const directory = yield* MemberDirectory;
        const org = yield* freshOrg();
        const other = yield* freshOrg();
        const ids = yield* seed(org);
        const found = yield* directory.findByEmail(org, "ada.lovelace@placeholder.test");
        const inactive = yield* directory.findByEmail(org, "gone@placeholder.test");
        const inactiveAsked = yield* directory.findByEmail(org, "gone@placeholder.test", [
          "inactive",
        ]);
        const wrongOrg = yield* directory.findByEmail(other, "ada.lovelace@placeholder.test");
        const batch = yield* directory.membersById(org, [ids.ada, ids.gone, "user_unknown"]);
        const batchAll = yield* directory.membersById(
          org,
          [ids.ada, ids.gone],
          ["active", "pending", "inactive"],
        );
        const empty = yield* directory.membersById(org, []);
        return {
          ids,
          found,
          inactive,
          inactiveAsked,
          wrongOrg,
          batch,
          batchAll,
          empty,
        };
      }),
    );
    expect(result.found?.accountId).toBe(result.ids.ada);
    expect(result.inactive, "an inactive member is not found by default").toBeNull();
    expect(result.inactiveAsked?.status, "but is when asked for").toBe("inactive");
    expect(result.wrongOrg).toBeNull();
    expect([...result.batch.keys()], "a batch excludes inactive by default").toEqual([
      result.ids.ada,
    ]);
    expect([...result.batchAll.keys()].sort()).toEqual([result.ids.ada, result.ids.gone].sort());
    expect(result.empty.size).toBe(0);
  });
});
