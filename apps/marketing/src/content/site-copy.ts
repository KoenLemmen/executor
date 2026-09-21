// ---------------------------------------------------------------------------
// Shared marketing copy. One source for text that must read the same in the
// HTML homepage and in the machine-readable Markdown endpoints
// (`/index.md`, `/setup-prompt.md`, `/pricing.md`).
//
// Import from here rather than duplicating strings: the homepage renders the
// human view, the endpoints render the agent view, and both must stay in step.
// ---------------------------------------------------------------------------

/**
 * Copied by the hero CTA and served verbatim at `/setup-prompt.md`.
 * Guides a coding agent through building and deploying a first app.
 */
export const setupPrompt = `Help me build and deploy my first app to Executor.

Executor is a cloud for personal software: a place to deploy apps for agents. An app can start as an MCP server, a custom tool, or a skill. Add approval rules, caching, a UI, webhooks, or cron jobs as needed.

Ask what I want my agent to do. Start as simply as possible: add an existing MCP server, write a skill, or build a custom tool. Do not add features I do not need.

Help me sign in at https://executor.sh/login and connect Executor to you over MCP. If your client needs a restart to load its tools, tell me and wait until they are available.

Read Executor's app-authoring guide through its skills tool before building. Check what this Executor host supports. Use its management tools to deploy the app, connect the required accounts through the secure connection flow, and select them for the app. Never ask me to paste credentials into this chat or put them in source code.

Start with one useful app. Explain what it can read or change, and ask before actions that send, delete, or publish anything. Verify it with a safe call. Keep the source so we can change it later.

Docs: https://executor.sh/docs`;

/** Canonical GitHub repository. */
export const GITHUB_URL = "https://github.com/UsefulSoftwareCo/executor";

/** One-line description of the product, used as the Markdown tagline. */
export const tagline = "Give your agents more to work with.";

/** Shared introduction for the landing page and its Markdown representation. */
export const introduction =
  "Deploy personal software for your agents. Start with an MCP server, a tool, or a skill.";

/** Plain definition shared by the illustrated section and Markdown overview. */
export const appDefinition =
  "Start with one useful thing. Add more tools, skills, or a UI as your needs grow.";

/** Simple starting points and optional extensions shared across page formats. */
export const mission = [
  "Add the Axiom MCP. Add the PostHog MCP. Each is an app, ready for your agent to use.",
  "Start as simple as you want. Add custom approval rules to an MCP server. Cache the results you use often. Give it a UI. It is still the same app.",
  "Just want to teach your agent how to do something? Start with a skill. Add tools or scheduled work when you need them.",
];

/** Optional additions to an MCP app, shown as composable pieces. */
export const appExtensions = ["Approval rules", "Caching", "A UI"];

/** Capabilities an app can include, with tools first. */
export const appParts = [
  { title: "Tools", body: "Call anything, it's just JavaScript." },
  { title: "Skills", body: "Give your agent instructions it can use again." },
  { title: "UI", body: "A page for your app, at its own URL." },
  { title: "Storage", body: "Keep data and state between runs." },
  { title: "Triggers", body: "Run on a schedule or respond to webhooks." },
  { title: "Workflows", body: "Durable work across multiple steps." },
] as const;

/** Cache-Control for the Markdown endpoints. Short, so copy edits land fast. */
export const MARKDOWN_CACHE_CONTROL = "public, max-age=300";

/** Content-Type for the Markdown endpoints. */
export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";

export type PricingTier = {
  readonly name: string;
  readonly price: string;
  readonly audience: string;
  readonly featuresLabel?: string;
  readonly features: ReadonlyArray<string>;
  readonly cta: string;
};

/**
 * Pricing tiers. The `/pricing` page and `/pricing.md` both read this list,
 * so it is the single source of truth.
 */
export const pricingTiers: ReadonlyArray<PricingTier> = [
  {
    name: "Free",
    price: "$0 / month",
    audience: "For small teams getting started",
    features: ["Up to 3 members", "100,000 executions per month", "Unlimited integrations"],
    cta: "Start free: https://executor.sh/login",
  },
  {
    name: "Team",
    price: "$15 / member / month",
    audience: "For growing organizations (recommended)",
    features: [
      "14-day free trial, then $15 / member / month",
      "Unlimited executions",
      "Verified domains & join by team domain",
    ],
    cta: "Start free trial: https://executor.sh/login",
  },
  {
    name: "Enterprise",
    price: "Custom",
    audience: "For orgs with custom needs",
    featuresLabel: "Everything in Team, plus",
    features: [
      "Self-hosted or dedicated cloud deployment support",
      "SSO / SAML & SCIM provisioning",
      "Audit logs for every tool call",
      "Dedicated support & onboarding",
      "Security reviews, DPA & SOC 2 on request",
    ],
    cta: "Contact rhys@executor.sh",
  },
];

export type Capability = {
  readonly title: string;
  readonly body: string;
  readonly comingSoon?: boolean;
};

/** Benefits shared by the homepage and the Markdown overview. */
export const capabilities: ReadonlyArray<Capability> = [
  {
    title: "Start with what you have.",
    body: "Add an MCP server or deploy your own code. Executor gives your apps a home.",
  },
  {
    title: "Connect once. Use it again.",
    body: "Select the accounts each app needs. Reuse your connections across apps.",
  },
  {
    title: "Change it. Deploy again.",
    body: "Keep improving your app. Executor retains its source and earlier code versions.",
  },
  {
    title: "Use it from your agents.",
    body: "Your apps live on Executor Cloud, ready for Claude Code, Codex, Cursor, and other MCP clients.",
  },
];

export type Faq = { readonly question: string; readonly answer: string };

/** Product questions for the machine-readable overview. */
export const faqs: ReadonlyArray<Faq> = [
  {
    question: "What is personal software?",
    answer:
      "Apps built or adapted for your own needs. Start with an MCP server, a custom tool, or a skill. Add only what you need.",
  },
  {
    question: "Do I need to write the code myself?",
    answer:
      "You can start by adding an existing MCP server. When you want to extend it, ask your coding agent or write the code yourself. A skill is also enough to start.",
  },
  {
    question: "How are my credentials used?",
    answer:
      "Executor stores account credentials separately from app source and supplies the selected credentials to app server code when it runs. Only run app code you trust. OAuth refresh tokens and client secrets remain with the host.",
  },
  {
    question: "Can I use more than one account?",
    answer:
      "Yes. Make separate configured copies of an app for different accounts, or write an app that uses several accounts together.",
  },
  {
    question: "Can every app have a web page and saved data?",
    answer:
      "Private app pages and saved app data are available locally. Self-hosted supports private app pages. Cloud app pages and hosted app data are still in development.",
  },
];

/** Response helper shared by the Markdown endpoints. */
export const markdownResponse = (body: string): Response =>
  new Response(body, {
    headers: {
      "Content-Type": MARKDOWN_CONTENT_TYPE,
      "Cache-Control": MARKDOWN_CACHE_CONTROL,
    },
  });
