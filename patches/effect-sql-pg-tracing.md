# PostgreSQL connection tracing

The Effect snapshot pinned at `c7d1ffff` traces SQL statements and transactions,
but its physical PostgreSQL connection acquisition has no span. A slow first
transaction therefore includes an unexplained interval before its first query.

`@effect%2Fsql-pg@c7d1ffff.patch` adds a client `sql.connect` span around the
driver's existing network connection and authentication effect. It ends when
PostgreSQL sends `ReadyForQuery`, or on failure or interruption. It adds no URL,
credentials, query text, or connection attributes. Password/config resolution
and later query execution are outside this span.

The patch changes both source and distributed JavaScript. It preserves lazy
pool acquisition, reuse, dead-connection replacement, idle release, and scoped
socket cleanup. It does not open a connection to measure it. The existing
`SqlClient.reserve` API could measure explicit reservation, but would require
an extra eager acquisition in application code.

The patch key uses the exact package URL, not its shared prerelease version.
Bun 1.3.11 accepts and applies this key with `bun install --frozen-lockfile`.
Its `bun patch --commit` command crashes for this URL dependency, so this patch
and the corresponding text lock entry were generated directly. Keep the key
aligned with the package URL when upgrading, and remove this patch if upstream
adds equivalent connection tracing.

Verify the real driver's public pool/connection APIs against a synthetic TCP
startup peer:

```sh
node --test apps/hosted/cloud/test/sql-connect.test.ts
```
