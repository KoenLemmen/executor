import type { APIRoute } from "astro";

import {
  capabilities,
  faqs,
  GITHUB_URL,
  markdownResponse,
  pricingTiers,
  tagline,
  introduction,
  mission,
  appParts,
  appDefinition,
  appExtensions,
} from "../content/site-copy";
import { testimonials } from "../content/testimonials";

// ---------------------------------------------------------------------------
// `/index.md` — the homepage as Markdown, for agents.
//
// Same content as src/pages/index.astro, without the layout, scripts, or
// interactive demos: an agent that fetches this gets the whole product in one
// read, plus links to the other machine-readable surfaces.
//
// The copy comes from src/content/site-copy.ts so the HTML page and this page
// cannot drift apart.
// ---------------------------------------------------------------------------

const machineSummaries = [
  ["Docs", "https://executor.sh/docs"],
  ["Setup prompt", "https://executor.sh/setup-prompt.md"],
  ["Pricing", "https://executor.sh/pricing.md"],
  ["llms.txt", "https://executor.sh/llms.txt"],
  ["GitHub", GITHUB_URL],
  ["Cloud", "https://executor.sh/"],
] as const;

const capabilityLines = capabilities.map(
  ({ title, body, comingSoon }, i) =>
    `${i + 1}. **${title}**${comingSoon ? " _(coming soon)_" : ""} — ${body}`,
);

const pricingLines = pricingTiers.map(({ name, price, audience, featuresLabel, features, cta }) =>
  [
    `### ${name} — ${price}`,
    "",
    audience,
    "",
    ...(featuresLabel === undefined ? [] : [`${featuresLabel}:`, ""]),
    ...features.map((f) => `- ${f}`),
    "",
    cta,
  ].join("\n"),
);

const faqLines = faqs.map(({ question, answer }) => `### ${question}\n\n${answer}`);

const body = `# Executor

> ${tagline}

## Machine summaries

${machineSummaries.map(([label, href]) => `- [${label}](${href})`).join("\n")}

## Everything’s an app

${introduction}

${mission.join("\n\n")}

MCP server + ${appExtensions.join(" + ")}

## How it works

1. Pick an MCP server, or make something of your own.
2. Deploy it to Executor.
3. Connect your accounts and put it to work.

## What can apps do?

${appDefinition}

${appParts.map(({ title, body }) => `- **${title}:** ${body}`).join("\n")}

## Different agents. Same apps.

Build with Claude. Use it from Codex, Cursor, or your next agent.
Your apps, connected accounts, and rules stay in Executor when you switch agents.

## Deployment

Deploy your app as one project. Executor builds and hosts it, connects the accounts
it needs, and retains its source and deployment history. Change the code and deploy
again as your needs change.

## What you get

${capabilityLines.join("\n\n")}

## Accounts and approvals

Credentials are stored separately from app source. Executor supplies the selected
credentials to trusted app server code when it runs. OAuth refresh tokens and
client secrets remain with the host. Apps can require approval before a tool runs.

## Ways to run it

- **Cloud:** run your tools without managing a server. https://executor.sh/
- **Desktop:** run Executor on your computer, with local apps and private app pages.
- **CLI:** run the local server from your terminal.
- **Self-hosted:** run the hosted server on infrastructure you control.

Private app pages and saved app data work locally. Self-hosted supports private
app pages. Cloud app pages and hosted app data are still in development.

## Pricing

Start free, pay per member. Full details: https://executor.sh/pricing.md

${pricingLines.join("\n\n")}

## What people say

From people using Executor to connect their agents to their tools.

${testimonials.map((t) => `- ${t.name} (@${t.handle}): "${t.text}" https://x.com/${t.handle}/status/${t.id}`).join("\n")}

## FAQ

${faqLines.join("\n\n")}

## Source

The existing Executor project: ${GITHUB_URL}
`;

export const GET: APIRoute = () => markdownResponse(body);
