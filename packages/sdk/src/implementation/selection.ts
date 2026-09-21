/** Validate stored account selections against a deployment's requirements. */
import { Effect } from "effect";
import {
  AccountSelectionInvalid,
  type AppRequirements,
  type SelectedAccounts,
} from "../contracts/apps.ts";
import type { AppId } from "../contracts/shared.ts";
import { storedAccount } from "./accounts.ts";
import type { Query } from "./database.ts";

/** Missing slots are allowed during setup; every supplied account must match. */
export const validateSelection = (
  db: Query,
  app: AppId,
  requirements: AppRequirements,
  selected: SelectedAccounts,
) =>
  Effect.gen(function* () {
    for (const [slot, value] of Object.entries(selected)) {
      const required = Object.hasOwn(requirements.accounts, slot)
        ? requirements.accounts[slot]
        : undefined;
      const invalid = (reason: AccountSelectionInvalid["reason"]) =>
        new AccountSelectionInvalid({ app, slot, reason });
      if (required === undefined) return yield* Effect.fail(invalid("unknown_slot"));
      const many = Array.isArray(value);
      if (required.cardinality === "one" && many)
        return yield* Effect.fail(invalid("expected_one"));
      if (required.cardinality === "many" && !many)
        return yield* Effect.fail(invalid("expected_many"));
      const ids = typeof value === "string" ? [value] : value;
      if (new Set(ids).size !== ids.length) return yield* Effect.fail(invalid("duplicate_account"));
      for (const id of ids) {
        const account = yield* storedAccount(db, id);
        if (account.provider !== required.provider)
          return yield* Effect.fail(invalid("provider_mismatch"));
      }
    }
  });
