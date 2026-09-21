/** Persistent V2 billing catalog. Autumn creates and owns the matching Stripe prices. */
import * as Alchemy from "alchemy";
import { stackState } from "./src/infrastructure/state.ts";
import { retain } from "alchemy/RemovalPolicy";
import { Stage } from "alchemy/Stage";
import { Config, Effect } from "effect";
import {
  AutumnFeature,
  AutumnPlan,
  autumnProviders,
} from "./src/infrastructure/autumn-provider.ts";

export default Alchemy.Stack(
  "executor-next-billing",
  {
    providers: autumnProviders(),
    state: stackState,
  },
  Effect.gen(function* () {
    const stage = yield* Stage;
    if (!/^[a-z0-9-]+$/.test(stage))
      return yield* Effect.die("Billing stage must be a lowercase slug");
    const environment = yield* Config.Literals(["sandbox", "live"], "AUTUMN_ENVIRONMENT");
    const namespace = `executor-next-${stage}`;
    const executions = yield* AutumnFeature("Executions", {
      featureId: `${namespace}-executions`,
      name: `Executions (${stage})`,
      consumable: true,
    }).pipe(retain());
    const members = yield* AutumnFeature("Members", {
      featureId: `${namespace}-members`,
      name: `Members (${stage})`,
      consumable: false,
    }).pipe(retain());
    const free = yield* AutumnPlan("Free", {
      planId: `${namespace}-free`,
      group: namespace,
      name: `Free (${stage})`,
      freeTrial: null,
      items: [
        { featureId: members.featureId, included: 3, unlimited: false },
        {
          featureId: executions.featureId,
          included: 100_000,
          unlimited: false,
          reset: { interval: "month" },
        },
      ],
    }).pipe(retain());
    const team = yield* AutumnPlan("Team", {
      planId: `${namespace}-team`,
      group: namespace,
      name: `Team (${stage})`,
      freeTrial: { durationLength: 14, durationType: "day", cardRequired: true },
      items: [
        {
          featureId: members.featureId,
          included: 0,
          unlimited: false,
          price: { amount: 15, billingUnits: 1, billingMethod: "usage_based", interval: "month" },
        },
        {
          featureId: executions.featureId,
          included: 0,
          unlimited: true,
          reset: { interval: "month" },
        },
      ],
    }).pipe(retain());
    return {
      environment,
      namespace,
      executions: executions.featureId,
      members: members.featureId,
      free: free.planId,
      team: team.planId,
    };
  }),
);
