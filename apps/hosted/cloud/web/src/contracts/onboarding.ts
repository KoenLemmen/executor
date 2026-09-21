import { organizationsAtom } from "@executor-js/hosted-web/contracts/organization";
import { acknowledge } from "@executor-js/ui/contracts/mutations";
import { Effect, Schema } from "effect";
import { Atom } from "effect/unstable/reactivity";
import { OnboardingReady, type CreateTeam } from "../../../src/contracts/onboarding.ts";
import { CloudClient } from "./billing.ts";

/** Prepare one stable draft per signed-in user without provisioning a team. */
export const prepareTeamAtom = Atom.family((_userId: string) =>
  CloudClient.runtime
    .atom((get) =>
      Effect.gen(function* () {
        const client = yield* CloudClient;
        const entry = yield* client.onboarding.prepare({});
        if (Schema.is(OnboardingReady)(entry))
          acknowledge(get, organizationsAtom, () => entry.organizations);
        return entry;
      }),
    )
    .pipe(Atom.withLabel("ui.onboarding.prepare")),
);

/** Only confirmation creates a team; publish its identity before the router changes pages. */
export const createTeamAtom = Atom.family((_userId: string) =>
  CloudClient.runtime
    .fn((details: CreateTeam, get) =>
      Effect.gen(function* () {
        const client = yield* CloudClient;
        const result = yield* client.onboarding.create({ payload: details });
        if (Schema.is(OnboardingReady)(result))
          acknowledge(get, organizationsAtom, () => result.organizations);
        return result;
      }),
    )
    .pipe(Atom.withLabel("ui.onboarding.create")),
);
