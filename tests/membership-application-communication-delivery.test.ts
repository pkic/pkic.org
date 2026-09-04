/**
 * What a staff-written communication actually delivers.
 *
 * The timeline row and the email are two halves of one act, and they used to
 * disagree: with no template chosen the send borrowed the on-hold-request
 * template, so the applicant received its canned subject ("We need more
 * information about your PKI Consortium application") while the timeline
 * showed the subject staff had typed. These tests assert the *rendered*
 * message handed to the provider, which is the only place that disagreement
 * was visible.
 *
 * The route queues the row and hands delivery to `waitUntil`, so each request
 * here keeps the background promise and awaits it rather than processing the
 * outbox itself — a second processor would race the route's own and claim
 * rows out from under it.
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import app from "../functions/router";
import { resetDb } from "./helpers/reset-db";
import { createAdminSession } from "./helpers/auth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
import { seedMemberApplication } from "./helpers/member-applications";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";
import { DIRECT_EMAIL_TEMPLATE_KEY } from "../assets/shared/schemas/email-outbox";
import type { Env } from "../functions/_lib/types";

const env = workerEnv as unknown as Env;

const APPLICANT_EMAIL = "communication-delivery@example.test";
const APPLICANT_NAME = "Example Applicant";
const TYPED_SUBJECT = "Following up on your application";
const TYPED_BODY = "We need one more document before we can continue the review.";
const HOLD_TEMPLATE_SUBJECT = "We need more information about your PKI Consortium application";

interface SendgridPayload {
  subject: string;
  content: Array<{ type: string; value: string }>;
  categories: string[];
}

/** Captures what would go to SendGrid, in the shape the provider receives. */
function captureSendgrid(): { sent: SendgridPayload[]; fetchMock: ReturnType<typeof vi.fn> } {
  const sent: SendgridPayload[] = [];
  const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)) as SendgridPayload);
    return Promise.resolve(new Response(null, { status: 202, headers: { "x-message-id": "msg-1" } }));
  });
  return { sent, fetchMock };
}

function plainTextOf(message: SendgridPayload): string {
  return message.content.find((part) => part.type === "text/plain")?.value ?? "";
}

async function seedTemplate(
  adminId: string,
  templateKey: string,
  content: string,
  subjectTemplate: string,
): Promise<void> {
  const version = await createTemplateVersion(env.DB, {
    templateKey,
    content,
    subjectTemplate,
    createdByUserId: adminId,
  });
  await activateTemplateVersion(env.DB, { templateKey, version: version.version });
}

describe("membership application communication delivery", () => {
  let adminToken: string;
  let adminId: string;
  let applicationId: string;

  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
    adminId = (await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'admin@pkic.org'"))[0].id;
    adminToken = await createAdminSession(env.DB, adminId, "application-communication-delivery-token");

    // resetDb() wipes email_template_versions, so the layout and partials the
    // renderer requires are re-seeded here rather than assumed.
    await seedTemplate(adminId, "email_layout", "{{{body_html}}}", "Email layout");
    for (const partial of ["reg_details", "sponsors_block", "about_pkic", "donation_request"]) {
      await seedTemplate(adminId, `partial_${partial}`, `Partial ${partial}`, `Partial: ${partial}`);
    }

    applicationId = await seedMemberApplication({
      applicantEmail: APPLICANT_EMAIL,
      applicantName: APPLICANT_NAME,
      organizationName: "Example Organization",
      membershipCategory: "F",
      stage: "pending",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Sends, then settles the delivery the route deferred to `waitUntil`. */
  async function sendCommunication(body: Record<string, unknown>): Promise<Response> {
    const deferred: Promise<unknown>[] = [];
    const response = await app.fetch(
      new Request(`https://app.test/api/v1/members/applications/${applicationId}/communications`, {
        method: "POST",
        headers: { authorization: `Bearer ${adminToken}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      env as never,
      {
        passThroughOnException: () => {},
        waitUntil: (promise: Promise<unknown>) => deferred.push(promise),
      } as never,
    );
    await Promise.allSettled(deferred);
    return response;
  }

  async function outboxRow(): Promise<{ template_key: string; status: string }> {
    const rows = await queryAll<{ template_key: string; status: string }>(
      env.DB,
      "SELECT template_key, status FROM email_outbox WHERE recipient_email = ?",
      APPLICANT_EMAIL,
    );
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  it("delivers the subject and body staff typed when no template is chosen", async () => {
    const { sent, fetchMock } = captureSendgrid();
    vi.stubGlobal("fetch", fetchMock);

    expect((await sendCommunication({ subject: TYPED_SUBJECT, body: TYPED_BODY })).status).toBe(201);

    // No template was chosen, so the row carries its own message rather than
    // some other workflow's key.
    expect(await outboxRow()).toEqual({ template_key: DIRECT_EMAIL_TEMPLATE_KEY, status: "sent" });

    expect(sent).toHaveLength(1);
    // The assertion the timeline row implies: the applicant reads the subject
    // line staff wrote, not a canned one.
    expect(sent[0].subject).toBe(TYPED_SUBJECT);
    expect(sent[0].subject).not.toBe(HOLD_TEMPLATE_SUBJECT);
    expect(plainTextOf(sent[0])).toContain(TYPED_BODY);
  });

  it("records no template on the timeline for a verbatim send", async () => {
    const { fetchMock } = captureSendgrid();
    vi.stubGlobal("fetch", fetchMock);

    expect((await sendCommunication({ subject: TYPED_SUBJECT, body: TYPED_BODY })).status).toBe(201);

    // The timeline says what happened: staff wrote this, no template rendered it.
    expect(
      await queryAll<{ subject: string; body: string; template_key: string | null }>(
        env.DB,
        "SELECT subject, body, template_key FROM application_communications WHERE application_id = ?",
        applicationId,
      ),
    ).toEqual([{ subject: TYPED_SUBJECT, body: TYPED_BODY, template_key: null }]);
  });

  it("renders a named template and takes its subject line from it", async () => {
    await seedTemplate(
      adminId,
      "application-hold-information",
      "Hi {{applicantName}},\n\n{{requestDetails}}",
      HOLD_TEMPLATE_SUBJECT,
    );
    const { sent, fetchMock } = captureSendgrid();
    vi.stubGlobal("fetch", fetchMock);

    expect(
      (
        await sendCommunication({
          subject: TYPED_SUBJECT,
          body: TYPED_BODY,
          templateKey: "application-hold-information",
        })
      ).status,
    ).toBe(201);

    expect(await outboxRow()).toEqual({ template_key: "application-hold-information", status: "sent" });

    expect(sent).toHaveLength(1);
    // Choosing a template is choosing its subject line — explicitly, which is
    // the whole difference from the default that used to be applied silently.
    expect(sent[0].subject).toBe(HOLD_TEMPLATE_SUBJECT);
    expect(plainTextOf(sent[0])).toContain(TYPED_BODY);
    expect(plainTextOf(sent[0])).toContain(APPLICANT_NAME);
  });

  it("refuses an empty templateKey rather than treating it as no template", async () => {
    const response = await sendCommunication({ subject: TYPED_SUBJECT, body: TYPED_BODY, templateKey: "   " });

    expect(response.status).toBe(400);
    expect(await queryAll(env.DB, "SELECT id FROM email_outbox WHERE recipient_email = ?", APPLICANT_EMAIL)).toEqual(
      [],
    );
  });
});
