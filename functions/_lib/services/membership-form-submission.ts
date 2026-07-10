/**
 * Files join-membership and sponsor-interest form submissions as GitHub
 * issues in pkic/members.
 *
 * Ported from the standalone `worker.js` Cloudflare Worker. Two behavior
 * changes from that version, both intentional:
 *  - The GitHub API response is checked for success; a failed issue
 *    creation now surfaces as an error instead of silently reporting
 *    success (there is currently no separate backup store, so this is the
 *    only signal that a submission didn't make it through).
 *  - Sponsor-interest submissions never get the domain-duplicate check —
 *    every sponsor lead should always get a clean issue.
 */
import type { Env } from "../types";
import { logError } from "../logging";

const GITHUB_ISSUES_URL = "https://api.github.com/repos/pkic/members/issues";

const SPONSOR_INTEREST_SUBJECT = "Sponsor interest";

const DUPLICATE_REVIEW_LABEL = "Review & Add to Mailing Lists";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "proton.me",
  "protonmail.com",
  "protonmail.ch",
  "pm.me",
  "hotmail.com",
  "hotmail.co.uk",
  "hotmail.fr",
  "hotmail.it",
  "hotmail.de",
  "outlook.com",
  "live.com",
  "msn.com",
  "live.co.uk",
  "yahoo.com",
  "yahoo.co.uk",
  "yahoo.fr",
  "yahoo.de",
  "yahoo.it",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "aol.com",
  "aim.com",
  "mail.com",
  "gmx.com",
  "gmx.net",
  "gmx.de",
  "yandex.com",
  "yandex.ru",
  "zoho.com",
  "tutanota.com",
  "tuta.io",
  "fastmail.com",
  "fastmail.fm",
]);

const EXCLUDE_LABELS = new Set(["close application", "rejected", "withdrew", "spam"]);

export class MembershipFormValidationError extends Error {}

interface GitHubIssue {
  number: number;
  state: string;
  state_reason?: string | null;
  body?: string | null;
  labels?: Array<{ name?: string }>;
}

function fieldToString(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Domain is everything after the last "@" — matches the extraction in assets/js/form.js. */
function emailDomainOf(email: string): string {
  const atIndex = email.lastIndexOf("@");
  return atIndex === -1 ? "" : email.slice(atIndex + 1).toLowerCase();
}

export async function submitMembershipForm(formData: FormData, env: Env): Promise<void> {
  const githubToken = env.GITHUB_TOKEN;
  if (!githubToken) {
    throw new Error("GITHUB_TOKEN is not configured");
  }

  const subject = fieldToString(formData.get("Subject"));
  const organization = fieldToString(formData.get("Organization"));
  const firstName = fieldToString(formData.get("First Name"));
  const lastName = fieldToString(formData.get("Last Name"));
  const email = fieldToString(formData.get("Email"));

  if (!subject || (!firstName && !lastName) || !email) {
    throw new MembershipFormValidationError("Missing required fields");
  }

  const requestor = organization || `${firstName} ${lastName}`.trim();

  let body = "";
  for (const [key, value] of formData.entries()) {
    if (key.toLowerCase() === "subject") continue;
    body += `**${key}**: ${typeof value === "string" ? value : "[file]"}\n`;
  }

  const labels = [subject];
  if (subject !== SPONSOR_INTEREST_SUBJECT) {
    const emailDomain = emailDomainOf(email);
    if (emailDomain && !PUBLIC_EMAIL_DOMAINS.has(emailDomain)) {
      const domainExists = await checkEmailDomainInIssues(emailDomain, githubToken);
      if (domainExists) {
        labels.push(DUPLICATE_REVIEW_LABEL);
      }
    }
  }

  const response = await fetch(GITHUB_ISSUES_URL, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "pkic.org forms",
      "Content-Type": "application/json;charset=UTF-8",
      Authorization: "Bearer " + githubToken,
    },
    body: JSON.stringify({
      title: `${subject} from ${requestor}`,
      labels,
      body,
    }),
  });

  if (!response.ok) {
    // Deliberately not logging headers/body here — the equivalent code in
    // worker.js logged the full request including the Authorization header.
    throw new Error(`GitHub issue creation failed with status ${response.status}`);
  }
}

/**
 * Strips characters that would let a value break out of a quoted GitHub
 * search-query phrase (e.g. `"` to close the phrase, `\` to escape it) and
 * inject arbitrary search qualifiers.
 */
function sanitizeForSearchQuery(value: string): string {
  return value.replace(/["\\]/g, "");
}

/**
 * Checks whether any non-excluded GitHub issue already mentions this email
 * domain. This is a non-critical enhancement (it only adds a review label)
 * layered on top of the GitHub Search API, which has a much lower rate
 * limit than the REST API used for issue creation — so any failure here
 * (rate limited, network error, unexpected response body) is swallowed and
 * treated as "no match found" rather than blocking the form submission.
 */
async function checkEmailDomainInIssues(emailDomain: string, githubToken: string): Promise<boolean> {
  try {
    const query = 'repo:pkic/members is:issue "' + sanitizeForSearchQuery(emailDomain) + '"';
    const response = await fetch("https://api.github.com/search/issues?q=" + encodeURIComponent(query), {
      method: "GET",
      headers: {
        Accept: "application/vnd.github.v3+json",
        "User-Agent": "pkic.org forms",
        Authorization: "Bearer " + githubToken,
      },
    });

    if (!response.ok) {
      return false;
    }

    // Matches "@<domain>" but not when followed by another domain/label
    // character, so "example.com" doesn't false-positive inside a body that
    // only mentions "example.com.au" (or "example.co" inside "example.com").
    const escapedDomain = emailDomain.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const domainRegex = new RegExp("@" + escapedDomain + "(?![a-zA-Z0-9.-])", "i");

    const result = (await response.json()) as { items?: GitHubIssue[] } | null;
    for (const issue of result?.items ?? []) {
      const issueLabels = issue.labels?.map((label) => (label.name ?? "").toLowerCase()) ?? [];
      if (issueLabels.some((label) => EXCLUDE_LABELS.has(label))) continue;
      if (issue.state === "closed" && issue.state_reason === "not_planned") continue;

      const bodyLower = issue.body?.toLowerCase() ?? "";
      if (
        issue.state === "closed" &&
        (bodyLower.includes("duplicate of") || bodyLower.includes("closed as duplicate"))
      ) {
        continue;
      }

      if (domainRegex.test(bodyLower)) {
        return true;
      }
    }

    return false;
  } catch (error) {
    logError("MEMBERSHIP_FORM_DOMAIN_CHECK_FAILED", { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}
