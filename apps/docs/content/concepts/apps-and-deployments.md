---
title: Apps and deployments
description: "An app is one configured copy of deployed code, with its own account selections. A deployment is one immutable, retained version of that code."
---

## App

An **app** is one configured use of some code. It has a name, an owner, the
deployment it currently runs, and the accounts it has selected.

The configuration is the point. The same code, configured twice, is two apps:

- "Work Vercel", selecting your work Vercel account.
- "Personal Vercel", selecting your personal one.

They share code and share a deployment lineage. They do not share a selection.
Adding a second copy of an app copies its configuration but deliberately does
not copy its account selections, so you cannot create a second app that quietly
uses the first one's credentials.

Each app has a slug. That slug is the namespace an agent uses:
`tools.<app-slug>.queries.<name>`.

## Deployment

A **deployment** is one immutable version of the source and its build. Deploying
uploads files, builds them, and activates the result only if the build succeeds.
A failed build leaves the running app alone.

Earlier deployments are retained, and an app can be pointed back at one. Apps in
the same code lineage can select the same deployment. The deployment record also
holds who deployed it.

Configured copies of the same code are grouped internally so their deployments
can be shared. That grouping is bookkeeping; it is not a separate thing you
manage.

## Getting an app

- **From the catalog.** Install a prepared app and select its accounts.
- **From a URL.** Import an MCP server, an OpenAPI document or a GraphQL
  endpoint as a custom app. Executor reads the operations and exposes them.
- **From source.** Write TypeScript and deploy it. See
  [Author an app](/build/author-an-app).

## The lifecycle

1. Deploy, or install from the catalog. The build produces a deployment.
2. Select an account for each requirement.
3. Use the tools, from the dashboard or through MCP.
4. Deploy again to change the code. Configuration and selections stay.

An agent that discovered an app's tools before a change holds a stale view.
Discover again in a new `execute` call after deploying or reconfiguring.

## What is coming later

- Rolling a new deployment out automatically to every configured copy.
- Updating hosted source through the deploy call. Hosted deployment currently
  creates a new named app and rejects a name that already exists.
- Stored data and schema migration between deployments.
- Scheduled work, and calls from one app to another.
