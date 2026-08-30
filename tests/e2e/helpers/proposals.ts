import { expect, type Page } from "@playwright/test";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";

export const PROPOSAL_EVENT_SLUG = "pqc-conference-amsterdam-nl";

/**
 * Submits a proposal the way the public form does, and returns the proposer's
 * own management capability from the confirmation mail.
 *
 * Consents come from the event's live speaker terms rather than a hard-coded
 * list, so a change to the required terms surfaces as a submission failure
 * here instead of silently leaving journeys consenting to nothing.
 */
export async function submitProposal(
  page: Page,
  options: { proposerEmail: string; firstName: string; lastName: string; title: string; abstract: string },
): Promise<{ accessToken: string; proposalId: string }> {
  const since = await capturedEmailCount();

  const submitted = await page.evaluate(
    async ({ slug, options }) => {
      const termsResponse = await fetch(`/api/v1/events/${slug}/terms?audience=speaker`);
      const terms = (await termsResponse.json()) as {
        terms: Array<{ termKey: string; version: string; required?: boolean }>;
      };
      const consents = terms.terms.map((term) => ({ termKey: term.termKey, version: term.version }));

      // Answer whatever the event's proposal form currently requires, derived
      // from the live placement. Hard-coded answers would drift the moment a
      // question is added, and the failure would look like a broken journey
      // rather than a changed form.
      const placementResponse = await fetch(`/api/v1/events/${slug}/forms/placements/proposal_submission`);
      const placement = (await placementResponse.json()) as {
        form: {
          fields: Array<{
            key: string;
            fieldType: string;
            required: boolean;
            options: Array<{ value: string }> | null;
          }>;
        } | null;
      };
      const details: Record<string, unknown> = {};
      for (const field of placement.form?.fields ?? []) {
        if (!field.required) continue;
        if (field.options && field.options.length > 0) {
          details[field.key] = field.fieldType === "multi_select" ? [field.options[0].value] : field.options[0].value;
          continue;
        }
        if (field.fieldType === "boolean") details[field.key] = true;
        else if (field.fieldType === "number") details[field.key] = 1;
        else if (field.fieldType === "email") details[field.key] = options.proposerEmail;
        else if (field.fieldType === "url") details[field.key] = "https://example.invalid/session";
        else if (field.fieldType === "date") details[field.key] = "2026-06-01";
        else details[field.key] = "Provided by a browser journey.";
      }

      const response = await fetch(`/api/v1/events/${slug}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          proposer: {
            email: options.proposerEmail,
            firstName: options.firstName,
            lastName: options.lastName,
            organizationName: "Proposal State Org",
            jobTitle: "Engineer",
            bio: "A proposer biography long enough to satisfy the shared speaker profile validation rules.",
          },
          proposal: { type: "talk", title: options.title, abstract: options.abstract, details },
          speakers: [],
          consents,
        }),
      });
      return { status: response.status, body: (await response.json()) as { proposalId?: string } };
    },
    { slug: PROPOSAL_EVENT_SLUG, options },
  );
  expect(submitted.status, JSON.stringify(submitted.body)).toBe(200);

  const message = await waitForCapturedEmail(options.proposerEmail, "proposal", { since });
  const manageUrl = extractEmailUrl(message, "/propose/manage/");
  const accessToken = new URL(manageUrl).searchParams.get("token") ?? "";
  expect(accessToken, "the confirmation mail must carry a management capability").toMatch(/^pkc1_/);

  return { accessToken, proposalId: submitted.body.proposalId! };
}

/** The proposer's own view of their proposal. */
export async function readProposalAccess(page: Page, token: string) {
  return page.evaluate(async (token) => {
    const response = await fetch(`/api/v1/proposals/access/${encodeURIComponent(token)}`);
    return {
      status: response.status,
      body: (await response.json()) as {
        proposal?: { id: string; title: string; abstract: string; status: string };
        speakers?: Array<{ userId: string; email: string; role: string }>;
      },
    };
  }, token);
}

export async function patchProposalAsProposer(
  page: Page,
  token: string,
  changes: Record<string, unknown>,
): Promise<number> {
  return page.evaluate(
    async ({ token, changes }) => {
      const response = await fetch(`/api/v1/proposals/access/${encodeURIComponent(token)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(changes),
      });
      return response.status;
    },
    { token, changes },
  );
}

export async function inviteCoSpeaker(
  page: Page,
  token: string,
  speaker: { email: string; firstName: string; lastName: string; role?: string },
): Promise<number> {
  return page.evaluate(
    async ({ token, speaker }) => {
      const response = await fetch(`/api/v1/proposals/access/${encodeURIComponent(token)}/speakers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...speaker, role: speaker.role ?? "co_speaker" }),
      });
      return response.status;
    },
    { token, speaker },
  );
}

export async function removeSpeaker(page: Page, token: string, userId: string): Promise<number> {
  return page.evaluate(
    async ({ token, userId }) => {
      const response = await fetch(
        `/api/v1/proposals/access/${encodeURIComponent(token)}/speakers/${encodeURIComponent(userId)}`,
        { method: "DELETE" },
      );
      return response.status;
    },
    { token, userId },
  );
}

export async function updateSpeaker(
  page: Page,
  token: string,
  userId: string,
  changes: Record<string, unknown>,
): Promise<number> {
  return page.evaluate(
    async ({ token, userId, changes }) => {
      const response = await fetch(
        `/api/v1/proposals/access/${encodeURIComponent(token)}/speakers/${encodeURIComponent(userId)}`,
        { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(changes) },
      );
      return response.status;
    },
    { token, userId, changes },
  );
}

/** Staff decision on a proposal (accept / reject / needs-work). */
export async function decideProposal(page: Page, proposalId: string, status: string): Promise<number> {
  return page.evaluate(
    async ({ proposalId, status }) => {
      const response = await fetch(`/api/v1/proposals/${proposalId}/decisions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ finalStatus: status, decisionNote: "Decided by a browser journey." }),
      });
      return response.status;
    },
    { proposalId, status },
  );
}
