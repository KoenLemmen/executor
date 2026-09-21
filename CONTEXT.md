# Executor

Executor connects reusable accounts to configured apps. Products decide who can
access those resources.

## Language

**Provider**:
A service/auth definition authored in app code, with named authentication
methods. Matching normalized definitions have the same provider reference and
can reuse accounts. It has no separately registered owner or slug.

**Authentication method**:
One named way to connect an account, such as OAuth or API-key fields.

**Account**:
An independently owned, reusable saved instance of a provider method.
Several apps can select the same account ID without copying credentials.
_Avoid_: Integration, connection as a replacement name for the saved account.

**App**:
One configured copy of deployed capabilities, with its own name, owner, active
deployment and selected accounts. Two Axiom apps can share code and select
different accounts.
_Avoid_: Integration.

**App code**:
The authored program behind configured copies. AppCodeId groups its retained
deployments without adding a separate management API.

**Deployment**:
One immutable source/build version. Configured apps in the same code lineage
can select the same deployment. Deployment ownership records who deployed it.

**Account slot**:
An app-wide named requirement. A provider requires one account; provider.many()
accepts zero or more. Selected account IDs are saved on the configured app.

**Owner**:
The opaque product identity to which an account, configured app or deployment
belongs. Ownership does not grant access to another resource.

**Tool**:
An operation exposed by a live app evaluation. Availability can depend on the
configured app's accounts and the service's current capabilities.
