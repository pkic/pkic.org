import { expect, request, type Page } from "@playwright/test";
import { eventFormsResponseSchema, eventTermsResponseSchema } from "../../../assets/shared/schemas/forms";
import {
  eventProposalProofStartSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifySchema,
  eventProposalProofVerifyResponseSchema,
} from "../../../assets/shared/schemas/event-proposal-proof";
import { proposalCreateSchema, proposalCreateResponseSchema } from "../../../assets/shared/schemas/proposal-management";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./sendgrid";
import { clientIpForIdentity } from "./portal-auth";

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
  options: {
    proposerEmail: string;
    firstName: string;
    lastName: string;
    title: string;
    abstract: string;
    eventSlug?: string;
    unaffiliatedAttestation?: boolean;
    actingIdentityId?: string | null;
  },
): Promise<{ accessToken: string; proposalId: string }> {
  // The caller may be staff; the verified fixture belongs to its own mailbox, not that staff session.
  const proposerRequest = await request.newContext({
    baseURL: new URL(page.url()).origin,
    extraHTTPHeaders: { "cf-connecting-ip": clientIpForIdentity(options.proposerEmail) },
  });
  try {
    const slug = options.eventSlug ?? PROPOSAL_EVENT_SLUG;
    const endpoint = `/api/v1/events/${slug}/proposals`;
    const termsResponse = await proposerRequest.get(`/api/v1/events/${slug}/terms?audience=speaker`);
    expect(termsResponse.status(), await termsResponse.text()).toBe(200);
    const terms = eventTermsResponseSchema.parse(await termsResponse.json());
    const consents = terms.terms.map(({ termKey, version }) => ({ termKey, version }));
    // These positive API fixtures deliberately attest individual participation.
    // Human-flow tests make this choice through the visible qualifier instead.
    const unaffiliatedAttestation = options.unaffiliatedAttestation ?? true;
    if (!unaffiliatedAttestation && options.actingIdentityId === undefined)
      throw new Error("Organization proposal fixtures require an explicit reviewed identity.");
    const proofSince = await capturedEmailCount();
    const started = await proposerRequest.post(`${endpoint}/proof`, {
      data: eventProposalProofStartSchema.parse({ email: options.proposerEmail, consents, unaffiliatedAttestation }),
    });
    expect(started.status(), await started.text()).toBe(200);
    expect(eventProposalProofStartResponseSchema.parse(await started.json()).status).toBe("verification_sent");
    const proofMail = await waitForCapturedEmail(options.proposerEmail, "Verify your email for", { since: proofSince });
    const verificationUrl = extractEmailUrl(proofMail, "/propose/");
    const token = new URLSearchParams(new URL(verificationUrl).hash.slice(1)).get("verify");
    const verified = await proposerRequest.post(`${endpoint}/proof/verify`, {
      data: eventProposalProofVerifySchema.parse({ token }),
    });
    expect(verified.status(), await verified.text()).toBe(200);
    const proof = eventProposalProofVerifyResponseSchema.parse(await verified.json());
    if (proof.status !== "ready") throw new Error("The positive proposal fixture requires a verified mailbox.");
    expect(proof.email).toBe(options.proposerEmail.toLowerCase());
    expect(proof.applicantKind).toBe(unaffiliatedAttestation ? "individual" : "organization");

    const placementResponse = await proposerRequest.get(`/api/v1/events/${slug}/forms/placements/proposal_submission`);
    expect(placementResponse.status(), await placementResponse.text()).toBe(200);
    const placement = eventFormsResponseSchema.parse(await placementResponse.json());
    const details: Record<string, unknown> = {};
    for (const field of placement.form?.fields ?? []) {
      if (!field.required) continue;
      const option = field.options?.find((item) => item.active);
      if (option) {
        details[field.key] = field.fieldType === "multi_select" ? [option.value] : option.value;
      } else if (field.fieldType === "boolean") details[field.key] = true;
      else if (field.fieldType === "number") details[field.key] = 1;
      else if (field.fieldType === "email") details[field.key] = options.proposerEmail;
      else if (field.fieldType === "url") details[field.key] = "https://example.invalid/session";
      else if (field.fieldType === "date") details[field.key] = "2026-06-01";
      else details[field.key] = "Provided by a browser journey.";
    }
    const since = await capturedEmailCount();
    const response = await proposerRequest.post(endpoint, {
      data: proposalCreateSchema.parse({
        continuationToken: proof.continuationToken,
        unaffiliatedAttestation,
        proposer: {
          email: proof.email,
          ...(proof.person ? {} : { firstName: options.firstName, lastName: options.lastName }),
          actingIdentityId: unaffiliatedAttestation ? null : options.actingIdentityId,
          bio: "A proposer biography long enough to satisfy the shared speaker profile validation rules.",
        },
        proposal: { type: "talk", title: options.title, abstract: options.abstract, details },
        speakers: [],
        consents,
      }),
    });
    expect(response.status(), await response.text()).toBe(200);
    const submitted = proposalCreateResponseSchema.parse(await response.json());
    const message = await waitForCapturedEmail(options.proposerEmail, "proposal", { since });
    const manageUrl = extractEmailUrl(message, "/propose/manage/");
    const accessToken = new URL(manageUrl).searchParams.get("token") ?? "";
    expect(accessToken, "the confirmation mail must carry a management capability").toMatch(/^pkc1_/);

    return { accessToken, proposalId: submitted.proposalId };
  } finally {
    await proposerRequest.dispose();
  }
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
