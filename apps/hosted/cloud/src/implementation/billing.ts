import { ExecutionAdmissionUnavailable, ExecutionLimitReached } from "@executor-js/hosted-server";
import { BillingMeter } from "../contracts/billing-meter.ts";
import { billingMembers } from "../infrastructure/billing-members.ts";
import {
  Authentication,
  organizationOwner,
  requireOrganizationAdmin,
  type OrganizationId,
} from "@executor-js/hosted-server";
import { makeExecutionMemo } from "alchemy/Runtime/ExecutionMemo";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient, HttpServerRequest } from "effect/unstable/http";
import { AutumnClient, type AutumnRequestFailed } from "../contracts/autumn.ts";
import { autumnLive } from "./autumn-client.ts";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import {
  Billing,
  BillingOverview,
  BillingPlanUnavailable,
  BillingUnavailable,
} from "../contracts/billing.ts";
import { ExecutorCloudApi } from "../contracts/api.ts";
import { billingSettings } from "../infrastructure/billing.ts";

/** Resolve the selected Autumn environment once; each invocation owns its client. */
export const billingLive = Effect.gen(function* () {
  // Resolve during initialization so Alchemy binds every value into the Worker environment.
  const settings = yield* billingSettings.pipe(Effect.orDie);
  // Test-stage settings resolve at runtime, so build the client inside the invocation, not here.
  const members = yield* billingMembers;
  const client = yield* makeExecutionMemo(
    Effect.gen(function* () {
      const secret = yield* settings.secretKey;
      const server = yield* settings.serverUrl;
      const catalog = yield* settings.catalog;
      const autumn = yield* AutumnClient.pipe(
        Effect.provide(autumnLive({ secretKey: secret, serverUrl: server })),
      );
      return { autumn, catalog };
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );
  const use = <A>(call: Effect.Effect<A, AutumnRequestFailed>) =>
    call.pipe(Effect.mapError(() => new BillingUnavailable()));
  const overview: typeof Billing.Service.overview = (organization) =>
    Effect.gen(function* () {
      const { autumn, catalog } = yield* client;
      const customerId = catalog
        ? `${catalog.namespace}:${organizationOwner(organization)}`
        : organizationOwner(organization);
      const customer = yield* use(
        autumn.getOrCreateCustomer({
          customerId,
          ...(catalog ? { autoEnablePlanId: catalog.free } : {}),
        }),
      );
      const plans = yield* use(autumn.listPlans({ customerId }));
      const balance = catalog ? customer.balances[catalog.executions] : undefined;
      return yield* Schema.decodeUnknownEffect(BillingOverview)({
        mode: settings.mode,
        usage: balance
          ? { used: balance.usage, remaining: balance.remaining, unlimited: balance.unlimited }
          : null,
        plans: plans.list
          .filter(
            (plan) =>
              !plan.archived &&
              (!catalog ||
                (plan.group === catalog.namespace &&
                  [catalog.free, catalog.team].includes(plan.id))),
          )
          .map((plan) => {
            const seats = catalog
              ? plan.items.find((item) => item.featureId === catalog.members)?.price
              : null;
            const price = plan.price ?? seats;
            return {
              id: plan.id,
              name: catalog ? (plan.id === catalog.free ? "Free" : "Team") : plan.name,
              price: price
                ? { amount: price.amount, interval: price.interval, unit: seats ? "member" : null }
                : null,
            };
          }),
        subscriptions: customer.subscriptions
          .filter(
            (subscription) =>
              !catalog || [catalog.free, catalog.team].includes(subscription.planId),
          )
          .map((subscription) => ({
            planId: subscription.planId,
            status: subscription.status,
          })),
      }).pipe(Effect.mapError(() => new BillingUnavailable()));
    });
  const customer = (organization: OrganizationId) =>
    Effect.gen(function* () {
      const { autumn, catalog } = yield* client;
      const customerId = catalog
        ? `${catalog.namespace}:${organizationOwner(organization)}`
        : organizationOwner(organization);
      const value = yield* use(
        autumn.getOrCreateCustomer({
          customerId,
          ...(catalog ? { autoEnablePlanId: catalog.free } : {}),
        }),
      );
      return { autumn, catalog, customerId, value };
    });
  const syncSeats = (organization: OrganizationId) =>
    Effect.gen(function* () {
      if (settings.mode === "emulator") return;
      const rows = yield* members.read(organization);
      const row = rows[0];
      if (row === undefined) return yield* new BillingUnavailable();
      const { autumn, catalog, customerId, value } = yield* customer(organization);
      if (catalog === null) return yield* new BillingUnavailable();
      const balance = value.balances[catalog.members];
      if (balance === undefined) return yield* new BillingUnavailable();
      if (balance.usage !== row.count)
        yield* use(
          autumn.updateBalance({ customerId, featureId: catalog.members, usage: row.count }),
        );
    }).pipe(Effect.withSpan("billing.syncSeats"));
  const meter = BillingMeter.of({
    consume: (organization) =>
      Effect.gen(function* () {
        if (settings.mode === "emulator") return;
        const { autumn, catalog, customerId } = yield* customer(organization);
        if (catalog === null) return yield* new BillingUnavailable();
        // Atomic check-and-consume prevents concurrent requests from overspending the allowance.
        // No automatic retries: a lost response is not evidence that consumption failed.
        const result = yield* use(
          autumn.check({
            customerId,
            featureId: catalog.executions,
            requiredBalance: 1,
            sendEvent: true,
          }),
        );
        if (
          result.balance === null ||
          result.balance === undefined ||
          result.balance.featureId !== catalog.executions
        )
          return yield* new BillingUnavailable();
        if (!result.allowed) return yield* new ExecutionLimitReached();
      }).pipe(
        Effect.catchTag("BillingUnavailable", () =>
          Effect.fail(new ExecutionAdmissionUnavailable()),
        ),
        Effect.withSpan("billing.admitExecution"),
      ),
    memberLimit: (organization) =>
      Effect.gen(function* () {
        if (settings.mode === "emulator") return Number.POSITIVE_INFINITY;
        const { catalog, value } = yield* customer(organization);
        return catalog &&
          value.subscriptions.some(
            (subscription) =>
              subscription.planId === catalog.team &&
              ["active", "trialing"].includes(subscription.status),
          )
          ? Number.POSITIVE_INFINITY
          : 3;
      }),
    syncSeats,
    reconcileSeats: Effect.gen(function* () {
      if (settings.mode === "emulator") return;
      const rows = yield* members.read();
      yield* Effect.forEach(rows, (row) => syncSeats(row.organization), {
        concurrency: 4,
        discard: true,
      });
    }).pipe(Effect.withSpan("billing.reconcileSeats")),
  });
  return Layer.mergeAll(
    Layer.succeed(BillingMeter, meter),
    Layer.succeed(
      Billing,
      Billing.of({
        overview,
        checkout: (organization, plan, returnUrl) =>
          Effect.gen(function* () {
            yield* syncSeats(organization);
            const current = yield* overview(organization);
            if (!current.plans.some((candidate) => candidate.id === plan))
              return yield* new BillingPlanUnavailable();
            if (
              current.subscriptions.some(
                (subscription) =>
                  subscription.planId === plan &&
                  ["active", "trialing"].includes(subscription.status),
              )
            )
              return { url: null };
            const success = new URL(returnUrl);
            success.searchParams.set("organization", organization);
            success.searchParams.set("plan", plan);
            const { autumn, catalog } = yield* client;
            const result = yield* use(
              autumn.attach({
                customerId: catalog
                  ? `${catalog.namespace}:${organizationOwner(organization)}`
                  : organizationOwner(organization),
                planId: plan,
                successUrl: success.href,
              }),
            );
            return { url: result.paymentUrl };
          }),
        portal: (organization, returnUrl) =>
          Effect.gen(function* () {
            yield* overview(organization);
            const { autumn, catalog } = yield* client;
            const result = yield* use(
              autumn.openCustomerPortal({
                customerId: catalog
                  ? `${catalog.namespace}:${organizationOwner(organization)}`
                  : organizationOwner(organization),
                returnUrl: returnUrl.href,
              }),
            );
            return { url: result.url };
          }),
      }),
    ),
  );
});

/** Every billing read and write requires a current owner/admin membership. */
export const billingHandlers = HttpApiBuilder.group(ExecutorCloudApi, "billing", (handlers) =>
  Effect.gen(function* () {
    const billing = yield* Billing;
    const auth = yield* Authentication;
    const destination = (organization: OrganizationId) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const slug = yield* auth.organizationSlug(new Headers(request.headers), organization);
        return new URL(`/org/${encodeURIComponent(slug)}/billing`, auth.origin);
      });
    return handlers
      .handle("overview", () =>
        Effect.gen(function* () {
          return yield* billing.overview((yield* requireOrganizationAdmin).organization);
        }),
      )
      .handle("checkout", ({ payload }) =>
        Effect.gen(function* () {
          const { organization } = yield* requireOrganizationAdmin;
          return yield* billing.checkout(
            organization,
            payload.plan,
            yield* destination(organization),
          );
        }),
      )
      .handle("portal", () =>
        Effect.gen(function* () {
          const { organization } = yield* requireOrganizationAdmin;
          return yield* billing.portal(organization, yield* destination(organization));
        }),
      );
  }),
);
