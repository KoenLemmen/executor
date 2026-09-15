---
"@executor-js/sdk": minor
"@executor-js/plugin-openapi": patch
"@executor-js/plugin-graphql": patch
"@executor-js/plugin-mcp": patch
---

Add bulk discovery of visible tools with self-contained input schemas, effective policies, and read-only metadata. Track catalog generations and rebuild ownership so concurrent rebuilds cannot publish a mixed catalog. Reject incomplete generations and rebuild affected connections on the next read. Keep toolkit visibility and policy decisions on one prepared snapshot.
