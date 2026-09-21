import { Schema } from "effect";

/** Display identity only; session tokens and organization preferences never cross this boundary. */
export const BrowserSession = Schema.NullOr(
  Schema.Struct({
    user: Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      image: Schema.NullOr(Schema.String),
    }),
  }),
);
export type BrowserSession = typeof BrowserSession.Type;
/** Preserve same-origin page destinations without allowing an auth or API redirect loop. */
export const browserReturnTo = (value: unknown): string => {
  if (typeof value !== "string" || !value.startsWith("/")) return "/";
  const target = URL.parse(value, "https://executor.invalid");
  return target !== null &&
    target.origin === "https://executor.invalid" &&
    target.pathname !== "/login" &&
    !target.pathname.startsWith("/login/") &&
    target.pathname !== "/api" &&
    !target.pathname.startsWith("/api/")
    ? target.pathname + target.search + target.hash
    : "/";
};
