import { cloudAuthOptions, cloudAuthSettings } from "./auth-options.ts";
/** The same explicit Postgres migration operation is used locally and in deployment jobs. */
import { PgClient } from "@effect/sql-pg";
import { Pool } from "pg";
import { databaseUrl } from "@executor-js/hosted-server/database";
import {
  HostedMigrationFailed,
  migrateHostedDatabase,
} from "@executor-js/hosted-server/migrations";
import { Config, Effect, Redacted } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { unavailableAuthEmail } from "../contracts/email.ts";

/** Additive cloud tables; existing organizations and memberships are never changed. */
export const migrateOnboarding = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`create table if not exists cloud_company_profile (
      domain text primary key,
      status text not null default 'pending' check (status in ('pending', 'ready', 'unavailable')),
      profile text check ((status = 'ready') = (profile is not null)),
      attempts integer not null default 0,
      lease text,
      retry_at timestamptz not null default now()
    )`;
      yield* sql`create table if not exists cloud_organization_setup (
      user_id text primary key references "user"(id) on delete cascade,
      organization_id text not null unique references organization(id) on delete cascade,
      domain text references cloud_company_profile(domain),
      name_edited boolean not null default false,
      logo_edited boolean not null default false,
      applied boolean not null default false
    )`;
      // Auth settings and enrichment use different adapters. Record explicit edits at
      // their shared storage boundary, including clearing a logo or changing a name back.
      yield* sql`create or replace function cloud_mark_organization_edit() returns trigger as $$
      begin
        update cloud_organization_setup set
          name_edited = name_edited or TG_ARGV[0] = 'name',
          logo_edited = logo_edited or TG_ARGV[0] = 'logo'
          where organization_id = NEW.id and not applied;
        return NEW;
      end;
      $$ language plpgsql`;
      yield* sql`drop trigger if exists cloud_organization_name_edit on organization`;
      yield* sql`create trigger cloud_organization_name_edit after update of name on organization
      for each row execute function cloud_mark_organization_edit('name')`;
      yield* sql`drop trigger if exists cloud_organization_logo_edit on organization`;
      yield* sql`create trigger cloud_organization_logo_edit after update of logo on organization
      for each row execute function cloud_mark_organization_edit('logo')`;
    }),
  );
}).pipe(Effect.mapError(() => new HostedMigrationFailed({ stage: "product" })));

/**
 * Queue future account creations in the same transaction as Better Auth's user insert.
 * No backfill: existing users receive no welcome. Verification is checked at delivery.
 * The queue owns only a user reference and delivery status, not a second profile copy.
 */
export const migrateWelcomeEmails = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.withTransaction(
    Effect.gen(function* () {
      yield* sql`create table if not exists cloud_email_preferences (
        user_id text primary key references "user"(id) on delete cascade,
        optional_emails_unsubscribed_at timestamptz
      )`;
      yield* sql`create table if not exists cloud_welcome_email (
        user_id text primary key references "user"(id) on delete cascade,
        status text not null default 'pending' check (status in ('pending', 'attempting', 'sent', 'uncertain')),
        created_at timestamptz not null default now(),
        attempted_at timestamptz,
        sent_at timestamptz,
        check ((status = 'pending') = (attempted_at is null)),
        check ((status = 'sent') = (sent_at is not null))
      )`;
      yield* sql`create index if not exists cloud_welcome_email_pending
        on cloud_welcome_email (created_at, user_id) where status = 'pending'`;
      yield* sql`create or replace function cloud_queue_welcome_email() returns trigger as $$
        begin
          insert into cloud_welcome_email (user_id) values (NEW.id) on conflict do nothing;
          return NEW;
        end;
        $$ language plpgsql`;
      yield* sql`drop trigger if exists cloud_welcome_email_created on "user"`;
      yield* sql`create trigger cloud_welcome_email_created after insert on "user"
        for each row execute function cloud_queue_welcome_email()`;
    }),
  );
}).pipe(Effect.mapError(() => new HostedMigrationFailed({ stage: "product" })));

/** Apply Better Auth and product migrations, then close both database pools. */
export const migrateCloudDatabase = Effect.scoped(
  Effect.gen(function* () {
    const url = yield* databaseUrl;
    const settings = yield* cloudAuthSettings;
    const secret = yield* Config.Redacted("BETTER_AUTH_SECRET");
    const database = yield* Effect.acquireRelease(
      Effect.try({
        try: () => new Pool({ connectionString: Redacted.value(url), max: 2 }),
        catch: () => new HostedMigrationFailed({ stage: "auth" }),
      }),
      (pool) => Effect.promise(() => pool.end()),
    );
    yield* migrateHostedDatabase({
      ...cloudAuthOptions(settings, [], unavailableAuthEmail),
      database,
      secret: Redacted.value(secret),
    }).pipe(
      Effect.andThen(migrateOnboarding),
      Effect.andThen(migrateWelcomeEmails),
      Effect.provide(PgClient.layer({ url, maxConnections: 1 })),
    );
    yield* Effect.log("Hosted Postgres schemas are current");
  }),
);
