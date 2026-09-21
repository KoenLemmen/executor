/** Capture and apply one app requirement, independently of account authentication. */
import { Effect } from "effect";
import {
  AccountConnectionTargetChanged,
  type AccountConnectionTarget,
} from "../contracts/account-connection.ts";
import { AccountSelectionInvalid } from "../contracts/apps.ts";
import type { Account } from "../contracts/account.ts";
import { StorageError, type ProviderId } from "../contracts/shared.ts";
import type { StoredConnectionTarget } from "../contracts/storage.ts";
import { lockApp, storedApp, storedDeployment } from "./apps.ts";
import { query, type Query } from "./database.ts";

/** Resolve a provider from the deployed requirement without evaluating account-dependent app code. */
export const captureConnectionTarget = (db: Query, target: typeof AccountConnectionTarget.Type) =>
  Effect.gen(function* () {
    const app = yield* storedApp(db, target);
    const deployment = yield* storedDeployment(db, app).pipe(
      Effect.mapError(() => new StorageError()),
    );
    const requirement = Object.hasOwn(deployment.requirements.accounts, target.requirement)
      ? deployment.requirements.accounts[target.requirement]
      : undefined;
    const invalid = (reason: AccountSelectionInvalid["reason"]) =>
      new AccountSelectionInvalid({ app: app.id, slot: target.requirement, reason });
    if (requirement === undefined) return yield* invalid("unknown_slot");
    const selection = Object.hasOwn(app.accounts, target.requirement)
      ? app.accounts[target.requirement]
      : undefined;
    if (requirement.cardinality === "one" && Array.isArray(selection))
      return yield* invalid("expected_one");
    if (requirement.cardinality === "many" && typeof selection === "string")
      return yield* invalid("expected_many");
    const snapshot: StoredConnectionTarget = {
      ...target,
      name: app.name,
      owner: app.owner,
      cardinality: requirement.cardinality,
      selection: selection ?? null,
    };
    return { provider: requirement.provider, snapshot };
  });

/** Run in the account-save transaction. A changed target rolls back credentials and selection together. */
export const applyConnectionTarget = (
  db: Query,
  target: StoredConnectionTarget,
  provider: ProviderId,
  account: Account,
) =>
  Effect.gen(function* () {
    const changed = () =>
      new AccountConnectionTargetChanged({ app: target.app, requirement: target.requirement });
    const app = yield* lockApp(db, { app: target.app, owner: target.owner }).pipe(
      Effect.catchTag("AppNotFound", () => Effect.fail(changed())),
    );
    const deployment = yield* storedDeployment(db, app).pipe(
      Effect.catchTags({
        DeploymentNotFound: () => Effect.fail(changed()),
        AppNotDeployed: () => Effect.fail(changed()),
      }),
    );
    const required = Object.hasOwn(deployment.requirements.accounts, target.requirement)
      ? deployment.requirements.accounts[target.requirement]
      : undefined;
    if (
      required === undefined ||
      required.provider !== provider ||
      required.provider !== account.provider ||
      required.cardinality !== target.cardinality
    )
      return yield* changed();
    const selected = Object.hasOwn(app.accounts, target.requirement)
      ? app.accounts[target.requirement]
      : undefined;
    let selection;
    if (required.cardinality === "one") {
      if ((selected ?? null) !== target.selection) return yield* changed();
      selection = account.id;
    } else {
      if (typeof selected === "string") return yield* changed();
      selection = [...new Set([...(selected ?? []), account.id])];
    }
    yield* query(() =>
      db.updateMany("apps", {
        where: (b) => b("id", "=", app.id),
        set: { accounts: { ...app.accounts, [target.requirement]: selection } },
      }),
    );
  });
