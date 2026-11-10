import { env } from "cloudflare:workers";
import { downloadZip } from "client-zip";
import { beforeEach, describe, expect, it } from "vitest";
import {
  eventEmailCampaignPreviewResponseSchema,
  eventEmailCampaignResponseSchema,
} from "../assets/shared/schemas/event-email-campaigns";
import { loadStoredFileAttachments, parseQueuedEmailAttachments } from "../functions/_lib/email/attachments";
import { processPendingPromotionRecipients } from "../functions/_lib/services/event-agenda/promotion-batch-dispatch";
import { processPromotionRenderJob } from "../functions/_lib/services/event-agenda/promotion-render-jobs";
import { stagePendingSpeakerKitEmails } from "../functions/_lib/services/event-email-campaign";
import { cleanExpiredCampaignSnapshots } from "../functions/_lib/services/event-email-campaign/dispatch";
import { readStoredZipEntries } from "../functions/_lib/utils/stored-zip";
import { callApi } from "./helpers/app";
import { eventBase, promotionFixture } from "./helpers/promotion-fixture";
import { emailPlainText } from "../functions/_lib/email/plain-text";
import { resetDb } from "./helpers/reset-db";
import { activateTemplateVersion, createTemplateVersion } from "../functions/_lib/email/templates";

type Fixture = Awaited<ReturnType<typeof promotionFixture>>;

const campaigns = `${eventBase}/email/campaigns`;
const message = {
  subjectOverride: "Your promotion kit for {{sessionTitle}}",
  bodyContent: "Hi {{firstName}}, [open your kit]({{promotionKitUrl}}).",
  sendMode: "personal",
  filter: { audience: "speakers", speakerStatus: "scheduled" },
  kit: { formats: ["portrait", "carousel"], resend: false },
};

function post(f: Fixture, path: string, body: unknown) {
  return callApi(env, path, { method: "POST", headers: f.headers, body: JSON.stringify(body) });
}

async function preview(f: Fixture, body: unknown = message) {
  const response = await post(f, `${campaigns}/previews`, body);
  expect(response.status, await response.clone().text()).toBe(200);
  return eventEmailCampaignPreviewResponseSchema.parse(await response.json());
}

async function send(f: Fixture, body: Record<string, unknown> = message) {
  const { previewToken } = await preview(f, body);
  const response = await post(f, campaigns, { ...body, previewToken });
  expect(response.status, await response.clone().text()).toBe(202);
  return eventEmailCampaignResponseSchema.parse(await response.json());
}

async function kitFixture(withSecondSpeaker = false) {
  const f = await promotionFixture(withSecondSpeaker);
  for (const templateKey of [
    "email_layout",
    "partial_sponsors_block",
    "partial_about_pkic",
    "partial_donation_request",
  ]) {
    const version = await createTemplateVersion(env.DB, {
      templateKey,
      content: templateKey === "email_layout" ? "{{{body_html}}}" : "Details",
      subjectTemplate: null,
      createdByUserId: f.admin.id,
    });
    await activateTemplateVersion(env.DB, { templateKey, version: version.version });
  }
  return f;
}

async function renderPendingKits() {
  while ((await processPendingPromotionRecipients(env.DB, 1)).prepared > 0);
  const jobs = await env.DB.prepare("SELECT id,format FROM event_promotion_renders WHERE status='queued'").all<{
    id: string;
    format: string;
  }>();
  for (const job of jobs.results)
    await processPromotionRenderJob(env.DB, env, job.id, async () => ({
      body: new Uint8Array([1, 2, 3]),
      contentType: job.format === "carousel" ? "application/pdf" : "image/jpeg",
      count: 1,
      thumbnail: { bytes: new Uint8Array([9]), contentType: "image/webp" },
    }));
}

async function outbox() {
  const rows = await env.DB.prepare(
    "SELECT recipient_email,payload_json,idempotency_key FROM email_outbox WHERE idempotency_key LIKE 'speaker-kit%' ORDER BY recipient_email,created_at",
  ).all<{ recipient_email: string; payload_json: string; idempotency_key: string }>();
  return rows.results;
}

describe("speaker kit emails", () => {
  beforeEach(() => resetDb());

  it("sends each speaker their finished kit once and only repeats it on request", async () => {
    const f = await kitFixture(true);
    const reviewed = await preview(f);
    expect(reviewed.recipientCount).toBe(2);
    expect(reviewed.subject).toContain("Planning a quantum-safe migration");

    expect((await send(f)).queuedRecipients).toBe(2);
    while ((await processPendingPromotionRecipients(env.DB, 1)).prepared > 0);
    expect(await stagePendingSpeakerKitEmails(env.DB)).toEqual({ processed: 0, queued: 0, failed: 0 });
    expect(await outbox()).toHaveLength(0);

    await renderPendingKits();
    expect(await stagePendingSpeakerKitEmails(env.DB)).toEqual({ processed: 2, queued: 2, failed: 0 });
    const sent = await outbox();
    expect(sent.map((row) => row.recipient_email)).toEqual(["admin@pkic.org", "bulk-speaker@example.test"]);
    const payload = JSON.parse(sent[1]!.payload_json) as Record<string, unknown>;
    expect(payload).toMatchObject({
      firstName: emailPlainText("Second"),
      sessionTitle: emailPlainText("Planning a quantum-safe migration"),
      promotionKitUrl: expect.stringContaining("/portal/#/events/pqc-2026/promotion"),
    });
    expect(parseQueuedEmailAttachments(payload).map((file) => file.filenameBase)).toEqual([
      "planning-a-quantum-safe-migration-tall-post",
      "planning-a-quantum-safe-migration-carousel",
    ]);

    expect((await preview(f)).recipientCount).toBe(0);

    const resend = { ...message, kit: { ...message.kit, resend: true } };
    expect((await send(f, resend)).queuedRecipients).toBe(2);
    await renderPendingKits();
    expect(await stagePendingSpeakerKitEmails(env.DB)).toEqual({ processed: 2, queued: 2, failed: 0 });
    expect(await outbox()).toHaveLength(4);
  });

  it("settles a batch whose template was retired so it cannot block later batches", async () => {
    const f = await kitFixture();
    await send(f);
    await send(f, { ...message, kit: { ...message.kit, resend: true } });
    await renderPendingKits();
    await env.DB.prepare(
      "UPDATE email_template_versions SET status='archived' WHERE template_key='email_layout'",
    ).run();

    const passes = [await stagePendingSpeakerKitEmails(env.DB), await stagePendingSpeakerKitEmails(env.DB)];
    expect(passes.map(({ processed }) => processed)).toEqual([1, 1]);
    expect(passes.reduce((sum, pass) => sum + pass.failed, 0)).toBe(2);
    expect(await stagePendingSpeakerKitEmails(env.DB)).toEqual({ processed: 0, queued: 0, failed: 0 });
    expect(await outbox()).toHaveLength(0);
  });

  it("delivers a test to the organizer without counting as the speaker's copy", async () => {
    const f = await kitFixture(true);
    const { previewToken } = await preview(f);
    const response = await post(f, `${campaigns}/tests`, { ...message, previewToken });
    expect(response.status, await response.clone().text()).toBe(202);
    // The message stays with its campaign until the kit email reaches the outbox.
    await env.DB.prepare("UPDATE event_email_campaigns SET expires_at='2000-01-01T00:00:00.000Z'").run();
    await cleanExpiredCampaignSnapshots(env.DB);
    await renderPendingKits();
    expect(await stagePendingSpeakerKitEmails(env.DB)).toEqual({ processed: 1, queued: 1, failed: 0 });
    expect((await outbox()).map((row) => row.recipient_email)).toEqual(["admin@pkic.org"]);
    expect((await preview(f)).recipientCount).toBe(2);
  });

  it("settles as failed without emailing when the agenda changes before the kit is ready", async () => {
    const f = await kitFixture();
    await send(f);
    await renderPendingKits();
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=published_revision+1 WHERE event_id=?")
      .bind(f.eventId)
      .run();
    expect(await stagePendingSpeakerKitEmails(env.DB)).toEqual({ processed: 1, queued: 0, failed: 1 });
    expect(await outbox()).toHaveLength(0);
    const kit = await env.DB.prepare("SELECT email_status FROM event_promotion_batch_recipients").first();
    expect(kit).toEqual({ email_status: "failed" });
  });

  it("narrows speakers to the sessions on one day of the event", async () => {
    const f = await kitFixture();
    const onDay = await preview(f, { ...message, filter: { ...message.filter, dayDate: "2026-12-01" } });
    expect(onDay.recipientCount).toBe(1);
    const otherDay = await preview(f, { ...message, filter: { ...message.filter, dayDate: "2026-12-02" } });
    expect(otherDay.recipientCount).toBe(0);
  });

  it.each([
    ["an audience with no agenda session", { filter: { audience: "speakers", speakerStatus: "confirmed" } }],
    ["a shared BCC send", { sendMode: "bcc_batch" }],
  ])("refuses a kit on %s", async (_case, change) => {
    const f = await kitFixture();
    expect((await post(f, `${campaigns}/previews`, { ...message, ...change })).status).toBe(400);
  });

  it("keeps kit tests to event communicators", async () => {
    const f = await kitFixture();
    const test = await callApi(env, `${campaigns}/tests`, {
      method: "POST",
      headers: f.attendeeHeaders,
      body: JSON.stringify({ ...message, previewToken: "x".repeat(32) }),
    });
    expect(test.status).toBe(403);
  });

  it("attaches each image of a multi-page archive as its own file", async () => {
    const archive = new Uint8Array(
      await downloadZip([
        { name: "session-portrait-01.jpg", input: new Uint8Array([1, 2]) },
        { name: "session-portrait-02.jpg", input: new Uint8Array([3, 4, 5]) },
      ]).arrayBuffer(),
    );
    expect(readStoredZipEntries(archive).map((entry) => [entry.name, [...entry.bytes]])).toEqual([
      ["session-portrait-01.jpg", [1, 2]],
      ["session-portrait-02.jpg", [3, 4, 5]],
    ]);

    await env.ASSETS_BUCKET!.put("kit.zip", archive, { httpMetadata: { contentType: "application/zip" } });
    const files = await loadStoredFileAttachments(env.ASSETS_BUCKET!, [
      { kind: "r2-stored-file", r2Key: "kit.zip", filenameBase: "talk-tall-post" },
    ]);
    expect(files.map(({ filename, contentType }) => [filename, contentType])).toEqual([
      ["talk-tall-post-01.jpg", "image/jpeg"],
      ["talk-tall-post-02.jpg", "image/jpeg"],
    ]);
    await expect(
      loadStoredFileAttachments(env.ASSETS_BUCKET!, [
        { kind: "r2-stored-file", r2Key: "missing", filenameBase: "talk-carousel" },
      ]),
    ).rejects.toThrow();
  });
});
