# Import-driven Worker dependencies

Executor provides the `apps/*` framework modules in its Worker snapshot.
Generated portable app manifests also declare optional framework peers for the
Node runtime. Installing all those declarations before a Cloud compile fetched
and unpacked packages the compiler never imported.

The pinned worker-bundler patch adds `CreateAppOptions.installDependencies`,
which defaults to the previous eager behavior. Executor sets it to false and
supplies an esbuild resolver that installs declared npm packages when a reachable
import needs them. The existing installer still resolves package versions,
transitive dependencies and binary assets. The existing resolver still handles
package exports and build conditions. Installation is serialized per build;
there is no cross-request dependency or credential cache.

The installer receives a narrow view of the root manifest for the selected
package. The compiler and retained source receive the original manifest, so an
app that imports its own package.json sees its original declarations. Framework
imports remain owned by the host. Browser dependencies and bare WASM imports go
through the same resolver before the existing browser/WASM plugins.

The patch is limited to `createApp`; other consumers keep eager installation.
It also retains the earlier binary-WASM patch. Recheck the option and pinned
plugin hook when updating worker-bundler.

Live Cloud checks cover direct npm imports, importing the original manifest,
unused declarations, a public MCP import and tool call, a WASM round trip, and a
React browser build. Timing comparisons are in `notes/install-latency.md`.
