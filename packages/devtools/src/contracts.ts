/** Local-only dev tools protocol shared by the three product shells. */
import { Schema } from "effect";

/** Reserved loopback origins are the only eligible hosts for development shortcuts. */
export const LoopbackOrigin = Schema.String.check(
  Schema.makeFilter(
    (value) => {
      try {
        const url = new URL(value);
        return (
          ["http:", "https:"].includes(url.protocol) &&
          url.origin === value &&
          (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
            url.hostname.endsWith(".localhost"))
        );
      } catch {
        return false;
      }
    },
    { message: "Dev tools require an exact loopback HTTP(S) origin" },
  ),
);

/** Test membership roles supported by hosted products. Local has no account roles. */
export const TestRole = Schema.Literals(["member", "admin", "owner"]);
/** A host advertises only the development capability it implements. */
export const DevtoolsState = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("accounts"),
    host: Schema.Literals(["self-host", "cloud"]),
    organization: Schema.String,
    accounts: Schema.Array(Schema.Struct({ role: TestRole, email: Schema.String })),
    selected: Schema.NullOr(TestRole),
  }),
  Schema.Struct({
    kind: Schema.Literal("pairing"),
    host: Schema.Literal("local"),
    paired: Schema.Boolean,
  }),
]);
/** A role selects a fixed fixture, never a supplied user ID. */
export const TestSignIn = Schema.Struct({ role: TestRole });
/** A successful action changes the browser's HttpOnly session cookie. */
export const DevtoolsSuccess = Schema.Struct({ status: Schema.Literal(true) });
