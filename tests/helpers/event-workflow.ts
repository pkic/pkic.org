import type { DatabaseLike } from "../../functions/_lib/types";
import { activateTemplateVersion, createTemplateVersion } from "../../functions/_lib/email/templates";

async function seedTemplate(
  db: DatabaseLike,
  adminId: string,
  templateKey: string,
  content: string,
  subjectTemplate: string,
): Promise<void> {
  const version = await createTemplateVersion(db, {
    templateKey,
    content,
    subjectTemplate,
    createdByUserId: adminId,
  });

  await activateTemplateVersion(db, {
    templateKey,
    version: version.version,
  });
}

export async function seedWorkflowEmailTemplates(db: DatabaseLike, adminId: string): Promise<void> {
  await seedTemplate(db, adminId, "email_layout", "{{{body_html}}}", "Email layout");
  await seedTemplate(db, adminId, "partial_reg_details", "Registration details", "Partial: registration details");
  await seedTemplate(db, adminId, "partial_sponsors_block", "Sponsors block", "Partial: sponsors block");
  await seedTemplate(db, adminId, "partial_about_pkic", "About PKIC", "Partial: about PKIC");
  await seedTemplate(db, adminId, "partial_donation_request", "Donation request", "Partial: donation request");
  await seedTemplate(
    db,
    adminId,
    "admin_magic_link",
    "Click [sign in]({{{magicLinkUrl}}}). Expires in {{expiresInMinutes}} minutes.",
    "Admin sign-in link",
  );
  await seedTemplate(
    db,
    adminId,
    "speaker_invite",
    "Invitation to speak: {{{proposalUrl}}}. Decline: {{{declineUrl}}}.",
    "Speaker invitation",
  );
  await seedTemplate(
    db,
    adminId,
    "co_speaker_invite",
    "You have been added as a speaker. Manage: {{{manageUrl}}}.",
    "Co-speaker invitation",
  );
  await seedTemplate(
    db,
    adminId,
    "proposal_submitted",
    "Proposal **{{proposalTitle}}** submitted. Manage: {{{manageUrl}}}.",
    "Proposal submitted",
  );
  await seedTemplate(
    db,
    adminId,
    "proposal_decision",
    "Decision for **{{proposalTitle}}**: {{finalStatus}}. {{decisionNote}}",
    "Proposal decision",
  );
  await seedTemplate(
    db,
    adminId,
    "registration_confirm_email",
    "Confirm registration: {{{confirmationUrl}}}. Manage: {{{manageUrl}}}. Share: {{{shareUrl}}}.",
    "Confirm registration",
  );
  await seedTemplate(
    db,
    adminId,
    "registration_confirmed",
    "Registration confirmed for {{eventName}}. Manage: {{{manageUrl}}}. Share: {{{shareUrl}}}.",
    "Registration confirmed",
  );
  await seedTemplate(
    db,
    adminId,
    "attendee_invite",
    "Register: {{{registrationUrl}}}. Decline: {{{declineUrl}}}.",
    "Attendee invite",
  );
  await seedTemplate(
    db,
    adminId,
    "registration_updated",
    "Registration updated for {{eventName}}. Manage: {{{manageUrl}}}.",
    "Registration updated",
  );
}

export interface CapturedSendgridRequest {
  url: string;
  payload: Record<string, unknown>;
}

export function captureSendgridRequests(): {
  requests: CapturedSendgridRequest[];
  restore: () => void;
} {
  const requests: CapturedSendgridRequest[] = [];
  const originalFetch = globalThis.fetch.bind(globalThis);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

    const payloadText = typeof init?.body === "string" ? init.body : "";
    const payload = payloadText ? JSON.parse(payloadText) as Record<string, unknown> : {};

    requests.push({ url, payload });

    return new Response(null, {
      status: 202,
      headers: { "x-message-id": `msg-${requests.length}` },
    });
  }) as typeof fetch;

  return {
    requests,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}

export function extractUrlFromOutboxPayload(payloadJson: string, fieldName: string): string {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>;
  const value = payload[fieldName];

  if (typeof value !== "string" || !value) {
    throw new Error(`Missing ${fieldName} in outbox payload`);
  }

  return value;
}

export function extractTokenFromOutboxPayload(payloadJson: string, fieldName: string): string {
  const url = new URL(extractUrlFromOutboxPayload(payloadJson, fieldName));
  const token = url.searchParams.get("token");

  if (!token) {
    throw new Error(`Missing token in ${fieldName}`);
  }

  return token;
}

export function findCapturedSendgridRequest(
  requests: CapturedSendgridRequest[],
  templateKey: string,
  recipientEmail?: string,
): CapturedSendgridRequest {
  for (let index = requests.length - 1; index >= 0; index -= 1) {
    const entry = requests[index];
    const categories = Array.isArray(entry.payload.categories) ? entry.payload.categories : [];
    const personalizations = Array.isArray(entry.payload.personalizations)
      ? entry.payload.personalizations as Array<{ to?: Array<{ email?: string }> }>
      : [];
    const email = personalizations[0]?.to?.[0]?.email;

    if (categories.includes(templateKey) && (!recipientEmail || email === recipientEmail)) {
      return entry;
    }
  }

  throw new Error(`No captured SendGrid request found for ${templateKey}`);
}

export async function waitForCapturedSendgridRequest(
  requests: CapturedSendgridRequest[],
  templateKey: string,
  recipientEmail?: string,
  timeoutMs = 2_000,
): Promise<CapturedSendgridRequest> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      return findCapturedSendgridRequest(requests, templateKey, recipientEmail);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  return findCapturedSendgridRequest(requests, templateKey, recipientEmail);
}

export function expectRenderedMessageToContainLinks(
  request: CapturedSendgridRequest,
  links: string[],
): void {
  const content = Array.isArray(request.payload.content)
    ? request.payload.content as Array<{ type?: string; value?: string }>
    : [];
  const html = content.find((part) => part.type === "text/html")?.value ?? "";
  const text = (content.find((part) => part.type === "text/plain")?.value ?? "").replaceAll("&amp;", "&");
  const hrefs = Array.from(html.matchAll(/href="([^"]+)"/g), (match) => match[1].replaceAll("&amp;", "&"));

  for (const link of links) {
    if (!hrefs.includes(link) && !text.includes(link) && !html.includes(link)) {
      throw new Error(`Rendered message did not include link: ${link}`);
    }
  }
}