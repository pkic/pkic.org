import { readFileSync } from "node:fs";
import type { CapturedEmail } from "../global-setup";

const SENDGRID_URL_FILE = process.env.E2E_SENDGRID_URL_FILE ?? "test-results/e2e-sendgrid-url";

export function sendgridServer(): string {
  return process.env.E2E_SENDGRID_API_BASE ?? readFileSync(SENDGRID_URL_FILE, "utf8").trim();
}

export async function capturedEmailCount(): Promise<number> {
  const response = await fetch(`${sendgridServer()}/outbox`);
  return ((await response.json()) as CapturedEmail[]).length;
}

export async function waitForCapturedEmail(
  to: string,
  subjectFragment: string,
  options: { timeoutMs?: number; since?: number } = {},
): Promise<CapturedEmail> {
  const deadline = Date.now() + (options.timeoutMs ?? 15_000);
  const since = options.since ?? 0;
  let emails: CapturedEmail[] = [];
  while (Date.now() < deadline) {
    const response = await fetch(`${sendgridServer()}/outbox`);
    emails = (await response.json()) as CapturedEmail[];
    for (let index = emails.length - 1; index >= since; index -= 1) {
      const email = emails[index];
      if (email.to === to && email.subject.toLowerCase().includes(subjectFragment.toLowerCase())) return email;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(
    `No email to <${to}> with subject containing "${subjectFragment}" was captured; ` +
      `outbox has ${emails.length} message(s), searching from ${since}.`,
  );
}

export function extractEmailUrl(email: CapturedEmail, urlSubstring: string): string {
  const content = email.payload.content as Array<{ type: string; value: string }> | undefined;
  const html = content?.find((item) => item.type === "text/html")?.value ?? "";
  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    if (match[1].includes(urlSubstring)) return match[1].replaceAll("&amp;", "&");
  }
  throw new Error(`No URL containing "${urlSubstring}" was found in email to <${email.to}>`);
}

export function extractVerificationCode(email: CapturedEmail): string {
  const content = email.payload.content as Array<{ type: string; value: string }> | undefined;
  const text = content?.find((item) => item.type === "text/plain")?.value ?? "";
  const code = text.match(/\b([A-HJ-NP-Z2-9]{8})\b/)?.[1];
  if (!code) throw new Error(`No verification code was found in email to <${email.to}>`);
  return code;
}
