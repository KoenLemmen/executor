import { Redacted } from "effect";
import type { AuthEmail, UnsubscribeLinks } from "../contracts/email.ts";

/** Shared with Better Auth so the message always states the code's actual lifetime. */
export const emailCodeExpiresIn = 300;

const purposes = {
  "sign-in": {
    heading: "Your sign-in code",
    instruction: "Copy and paste this code into Executor to sign in.",
  },
  "email-verification": {
    heading: "Verify your email address",
    instruction: "Copy and paste this code into Executor to verify your email address.",
  },
  "forget-password": {
    heading: "Your password reset code",
    instruction: "Copy and paste this code into Executor to reset your password.",
  },
  "change-email": {
    heading: "Confirm your new email address",
    instruction: "Copy and paste this code into Executor to confirm your new email address.",
  },
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/** Public docs live on the marketing site, not on the deployment origin. */
const docsUrl = "https://executor.sh/docs";

/**
 * A personal, all-lowercase welcome with matching text and HTML; recipient names are
 * escaped, never markup. It carries one starter prompt with the deployment's MCP URL and
 * the docs link, and the unsubscribe link is an ordinary sentence rather than a footer.
 */
export const welcomeEmailMessage = (
  email: string,
  name: string,
  links: UnsubscribeLinks,
  origin: string,
): AuthEmail => {
  const firstName = name.trim().split(/\s+/)[0];
  const greeting = firstName && !firstName.includes("@") ? `hey ${firstName},` : "hey there,";
  const starterPrompt = `add the executor mcp server at ${origin}/mcp, then read the executor docs at ${docsUrl} and work out how you can best use executor to help me.`;
  const paragraphs = [
    greeting,
    "i'm rhys, founder of executor - thanks for signing up!",
    "quick heads up: i hate getting emails as much as you do, so you won't get many from me. when i do send one, i'll make sure it's worth opening.",
    "on to the useful part. if you're still working out where to start, here's a prompt you can hand to your agent:",
    `"${starterPrompt}"`,
    "if you get stuck or have questions, just reply. this was an automated email but replies go straight to me, and i'd love to hear what you're using executor for.",
  ];
  const unsubscribeLead = "and if you'd rather not get these at all, the unsubscribe link is";
  const unsubscribeUrl = Redacted.value(links.browser);
  return {
    to: email,
    subject: "welcome to executor",
    text: Redacted.make(
      `${paragraphs.join("\n\n")}\n\n${unsubscribeLead} right here: ${unsubscribeUrl}`,
    ),
    html: Redacted.make(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>welcome to executor</title></head><body style="font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#171717;">${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}<p>${escapeHtml(unsubscribeLead)} <a style="color:#171717;" href="${escapeHtml(unsubscribeUrl)}">right here</a></p></body></html>`,
    ),
    headers: Redacted.make({
      "List-Unsubscribe": `<${Redacted.value(links.oneClick)}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    }),
  };
};

/** Render a compact code email with equivalent HTML and text; neither payload is log-safe. */
export const emailCodeMessage = ({
  email,
  otp,
  type,
}: {
  email: string;
  otp: string;
  type: keyof typeof purposes;
}): AuthEmail => {
  const { heading, instruction } = purposes[type];
  const expiry = `This code expires in ${emailCodeExpiresIn / 60} minutes. Never share this code with anyone.`;
  const unsolicited = "If you didn't request this, you can safely ignore this email.";
  return {
    to: email,
    subject: type === "sign-in" ? "Your Executor sign-in code" : `Executor: ${heading}`,
    text: Redacted.make(
      `Executor\n\n${heading}\n\n${instruction}\n\n${otp}\n\n${expiry}\n\n${unsolicited}`,
    ),
    html: Redacted.make(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${heading}</title></head>
<body style="margin:0;padding:0;background:#f6f6f6;color:#171717;font-family:Arial,Helvetica,sans-serif;">
  <table role="presentation" style="width:100%;border-collapse:collapse;"><tr><td style="padding:40px 16px;">
    <table role="presentation" align="center" style="width:100%;max-width:480px;border-collapse:collapse;background:#ffffff;"><tr><td style="padding:32px;">
      <p style="margin:0 0 32px;font-size:18px;font-weight:700;">Executor</p>
      <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;">${heading}</h1>
      <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">${instruction}</p>
      <p style="margin:0 0 24px;padding:20px 12px;background:#f3f3f3;text-align:center;font-family:Consolas,monospace;font-size:32px;font-weight:700;letter-spacing:6px;">${escapeHtml(otp)}</p>
      <p style="margin:0 0 16px;font-size:14px;line-height:1.6;">${expiry}</p>
      <p style="margin:0;color:#595959;font-size:14px;line-height:1.6;">${unsolicited}</p>
    </td></tr></table>
  </td></tr></table>
</body>
</html>`),
  };
};
