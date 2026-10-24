import { findOrCreateUser } from "../functions/_lib/services/users";
import { promotionBatchCreateSchema, promotionBatchSchema } from "../assets/shared/schemas/event-promotion-batches";
import { processPendingPromotionRecipients } from "../functions/_lib/services/event-agenda/promotion-batch-dispatch";
import { promotionPortraits } from "../functions/_lib/services/event-agenda/promotion-portraits";
import { getPromotionKit } from "../functions/_lib/services/event-agenda/promotion-kit";
import { validJpegBytes } from "./helpers/raster-images";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin } from "./helpers/context";
import { createAdminSession, createMcpSession } from "./helpers/auth";
import { callApi } from "./helpers/app";
import { createAgendaOccurrence } from "../functions/_lib/services/event-agenda/mutations";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../assets/shared/schemas/event-agenda";
import { promotionKitSchema } from "../assets/shared/schemas/event-promotion-kit";
import { promotionCompositionSaveSchema } from "../assets/shared/schemas/event-promotion-design";
import {
  processPromotionRenderJob,
  requestPromotionRender,
} from "../functions/_lib/services/event-agenda/promotion-render-jobs";
import { getAttendeePromotionKit } from "../functions/_lib/services/event-agenda/promotion-attendee";
import { recordReferralClick, recordReferralConversion } from "../functions/_lib/services/referrals";

const eventBase = "/api/v1/events/pqc-2026";
async function fixture(withSecondSpeaker = false) {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const admin = (await env.DB.prepare("SELECT id,email FROM users WHERE email='admin@pkic.org'").first<{
    id: string;
    email: string;
  }>())!;
  const headers = {
    authorization: `Bearer ${await createAdminSession(env.DB, admin.id, "promotion-admin")}`,
    "content-type": "application/json",
  };
  const secondSpeaker = withSecondSpeaker
    ? await findOrCreateUser(env.DB, { email: "bulk-speaker@example.test", firstName: "Second", lastName: "Speaker" })
    : null;
  const draft = await createAgendaOccurrence(
    env.DB,
    eventId,
    "pqc-2026",
    agendaOccurrenceCreateSchema.parse({
      expectedRevision: 0,
      title: "Planning a quantum-safe migration",
      description: "A practical session abstract about inventory, deployment and operational controls.",
      startAt: "2026-12-01T09:00:00.000Z",
      endAt: "2026-12-01T09:30:00.000Z",
      roomId: null,
      speakerUserIds: secondSpeaker ? [admin.id, secondSpeaker.id] : [admin.id],
    }),
    admin.id,
  );
  const reviewed = await callApi(env, `${eventBase}/agenda/occurrences/${draft.occurrences[0]!.id}/history`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      expectedRevision: draft.revision,
      history: {
        appearances: [
          ...(secondSpeaker
            ? [
                {
                  userId: secondSpeaker.id,
                  displayName: "Second Speaker",
                  affiliations: [],
                  biography: "",
                  photoUrl: null,
                  approvedAt: new Date().toISOString(),
                },
              ]
            : []),
          {
            userId: admin.id,
            displayName: "Example Speaker",
            affiliations: [],
            biography: "",
            photoUrl: null,
            approvedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  });
  expect(reviewed.status, await reviewed.clone().text()).toBe(200);
  const review = agendaSnapshotSchema.parse(await reviewed.json());
  const publish = await callApi(env, `${eventBase}/agenda/publications`, {
    method: "POST",
    headers,
    body: JSON.stringify({ expectedRevision: review.revision }),
  });
  expect(publish.status, await publish.clone().text()).toBe(200);
  const published = agendaSnapshotSchema.parse(await publish.json()),
    sessionId = published.occurrences[0]!.id;
  const userId = crypto.randomUUID(),
    registrationId = crypto.randomUUID(),
    at = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users(id,email,normalized_email,active,first_name,last_name,created_at,updated_at) VALUES(?,'promotion-attendee@example.test','promotion-attendee@example.test',1,'Example','Attendee',?,?)",
    ).bind(userId, at, at),
    env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','direct','synthetic-secret',?,?)",
    ).bind(registrationId, eventId, userId, at, at),
  ]);
  const attendeeHeaders = {
    authorization: `Bearer ${await createAdminSession(env.DB, userId, "promotion-attendee")}`,
    "content-type": "application/json",
  };
  return {
    eventId,
    admin,
    secondSpeaker,
    headers,
    userId,
    attendeeHeaders,
    sessionId,
    sessionBase: `${eventBase}/agenda/occurrences/${sessionId}/promotion`,
  };
}
describe("personal event promotion kits", () => {
  beforeEach(() => resetDb());
  it("prepares all published speaker kits durably, preserves attribution, and reports real render completion", async () => {
    const f = await fixture(true);
    const source = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const input = promotionBatchCreateSchema.parse({
      requestId: crypto.randomUUID(),
      publishedRevision: source.publishedRevision,
      formats: ["portrait", "carousel"],
    });
    const endpoint = `${eventBase}/promotion/batches`;
    const started = await callApi(env, endpoint, { method: "POST", headers: f.headers, body: JSON.stringify(input) });
    expect(started.status, await started.clone().text()).toBe(200);
    const batch = promotionBatchSchema.parse(await started.json());
    expect(batch).toMatchObject({ totalKits: 2, readyKits: 0, pendingKits: 2, status: "preparing" });
    const read = () => callApi(env, `${endpoint}/${batch.id}`, { headers: f.headers }, { maxRoundTrips: 1 });
    expect((await read()).status).toBe(200);
    const forbidden = await callApi(env, endpoint, {
      method: "POST",
      headers: f.attendeeHeaders,
      body: JSON.stringify({ ...input, requestId: crypto.randomUUID() }),
    });
    expect(forbidden.status).toBe(403);
    const repeated = await callApi(env, endpoint, { method: "POST", headers: f.headers, body: JSON.stringify(input) });
    expect(repeated.status).toBe(200);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS count FROM event_promotion_batch_recipients WHERE batch_id=?")
        .bind(batch.id)
        .first("count"),
    ).toBe(2);
    expect(await processPendingPromotionRecipients(env.DB, 0)).toEqual({ prepared: 0, failed: 0 });
    expect(await processPendingPromotionRecipients(env.DB, 1)).toEqual({ prepared: 1, failed: 0 });
    expect(promotionBatchSchema.parse(await (await read()).json()).status).toBe("preparing");
    expect(await processPendingPromotionRecipients(env.DB, 1)).toEqual({ prepared: 1, failed: 0 });
    expect(await processPendingPromotionRecipients(env.DB, 1)).toEqual({ prepared: 0, failed: 0 });
    expect(promotionBatchSchema.parse(await (await read()).json()).status).toBe("rendering");
    const jobs = await env.DB.prepare(
      "SELECT id,user_id,format FROM event_promotion_renders WHERE event_id=? AND occurrence_id=?",
    )
      .bind(f.eventId, f.sessionId)
      .all<{ id: string; user_id: string; format: string }>();
    expect(jobs.results).toHaveLength(4);
    const destinations = new Map<string, string>();
    destinations.set(f.admin.id, source.registrationUrl);
    destinations.set(
      f.secondSpeaker!.id,
      (await getPromotionKit(env.DB, f.eventId, f.sessionId, f.secondSpeaker!.id, "https://app.test")).kit
        .registrationUrl,
    );
    expect(new Set(destinations.values()).size).toBe(2);
    for (const job of jobs.results)
      await processPromotionRenderJob(env.DB, env, job.id, async (_env, _origin, data) => {
        expect(data.registrationUrl).toBe(destinations.get(job.user_id));
        expect(data.actorId).toBe(job.user_id);
        return {
          body: new Uint8Array([1, 2, 3]),
          contentType: job.format === "carousel" ? "application/pdf" : "image/png",
          count: 1,
        };
      });
    expect(promotionBatchSchema.parse(await (await read()).json())).toMatchObject({
      readyKits: 2,
      pendingKits: 0,
      failedKits: 0,
      status: "complete",
    });
    await env.DB.prepare("UPDATE event_agenda_state SET published_revision=published_revision+1 WHERE event_id=?")
      .bind(f.eventId)
      .run();
    expect(promotionBatchSchema.parse(await (await read()).json()).status).toBe("obsolete");
    const stale = await callApi(env, endpoint, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify({ ...input, requestId: crypto.randomUUID() }),
    });
    expect(stale.status).toBe(409);
  });
  it("provides a tracked default from the approved abstract without requiring takeaways", async () => {
    const f = await fixture();
    const response = await callApi(env, f.sessionBase, { headers: f.headers });
    expect(response.status).toBe(200);
    const kit = promotionKitSchema.parse(await response.json());
    expect(kit.copy.takeaways).toEqual([]);
    expect(kit.copy.whyAttend).toContain("practical session abstract");
    const code = new URL(kit.registrationUrl).pathname.split("/").at(-1)!;
    const referral = await env.DB.prepare("SELECT owner_id,created_by_user_id FROM referral_codes WHERE code=?")
      .bind(code)
      .first();
    expect(referral).toMatchObject({ owner_id: f.admin.id, created_by_user_id: f.admin.id });
    const at = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','virtual','direct','synthetic',?,?)",
    )
      .bind(crypto.randomUUID(), f.eventId, f.admin.id, at, at)
      .run();
    const after = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    expect(after.registrationUrl).toBe(kit.registrationUrl);
  });
  it("loads current profile portraits without routing API requests through static assets", async () => {
    const f = await fixture();
    const key = `headshots/${f.admin.id}/promotion.jpg`;
    await env.SPEAKER_UPLOADS_BUCKET!.put(key, validJpegBytes(64, 64));
    await env.DB.prepare("UPDATE users SET headshot_r2_key=? WHERE id=?").bind(key, f.admin.id).run();
    const source = await getPromotionKit(env.DB, f.eventId, f.sessionId, f.admin.id, "https://pkic.org");
    const portraits = await promotionPortraits({ ...env, IMAGES: undefined }, "https://pkic.org", {
      ...source,
      ...source.kit,
    });
    expect(portraits[f.admin.id]).toMatch(/^data:image\/jpeg;base64,/);
    await env.DB.prepare("UPDATE users SET headshot_r2_key=NULL WHERE id=?").bind(f.admin.id).run();
    expect(
      await promotionPortraits({ ...env, IMAGES: undefined }, "https://pkic.org", { ...source, ...source.kit }),
    ).toEqual({});
  });
  it("keeps speaker and attendee compositions private and rejects stale saves atomically", async () => {
    const f = await fixture();
    const original = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const input = promotionCompositionSaveSchema.parse({
      expectedRevision: 0,
      composition: {
        ...original.composition,
        panels: ["cover", "content", "register"],
        summary: "My personal introduction to a practical quantum-safe migration.",
      },
    });
    const saved = await callApi(env, `${f.sessionBase}/composition`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify(input),
    });
    expect(saved.status).toBe(200);
    const personal = promotionKitSchema.parse(await saved.json());
    expect(personal.compositionRevision).toBe(1);
    expect(personal.fingerprint).not.toBe(original.fingerprint);
    const stale = await callApi(env, `${f.sessionBase}/composition`, {
      method: "POST",
      headers: f.headers,
      body: JSON.stringify(input),
    });
    expect(stale.status).toBe(409);
    const denied = await callApi(env, `${f.sessionBase}/composition`, {
      method: "POST",
      headers: f.attendeeHeaders,
      body: JSON.stringify(input),
    });
    expect(denied.status).toBe(403);
    const audit = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM audit_log WHERE action='promotion_composition_saved'",
    ).first<{ count: number }>();
    expect(audit?.count).toBe(1);
    const attendeeResponse = await callApi(env, `${eventBase}/promotion`, { headers: f.attendeeHeaders });
    expect(attendeeResponse.status, await attendeeResponse.clone().text()).toBe(200);
    const attendee = promotionKitSchema.parse(await attendeeResponse.json());
    expect(attendee.audience).toBe("attendee");
    expect(attendee.compositionRevision).toBe(0);
    expect(attendee.registrationUrl).not.toBe(personal.registrationUrl);
    const source = await env.DB.prepare("SELECT description FROM event_agenda_occurrences WHERE id=?")
      .bind(f.sessionId)
      .first<{ description: string }>();
    expect(source?.description).toBe(original.copy.whyAttend);
  });
  it("lets an authorized MCP client save draft takeaways through the same personal contract", async () => {
    const f = await fixture();
    const token = await createMcpSession(env.DB, f.admin, "mcp-promotion", ["agenda:write"]);
    const headers = {
      authorization: `Bearer ${token}`,
      "x-pkic-machine-auth": "mcp",
      "content-type": "application/json",
    };
    const response = await callApi(env, f.sessionBase, { headers });
    expect(response.status).toBe(200);
    const kit = promotionKitSchema.parse(await response.json());
    const input = promotionCompositionSaveSchema.parse({
      expectedRevision: 0,
      composition: {
        ...kit.composition,
        takeaways: ["Inventory cryptographic dependencies", "Choose observable deployment controls"],
      },
    });
    const saved = await callApi(env, `${f.sessionBase}/composition`, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    });
    expect(saved.status).toBe(200);
    expect(promotionKitSchema.parse(await saved.json()).composition?.takeaways).toHaveLength(2);
  });
  it("accepts public session picks, queues attendee exports, and invalidates obsolete compositions", async () => {
    const f = await fixture();
    const response = await callApi(env, `${eventBase}/promotion`, { headers: f.attendeeHeaders });
    expect(response.status, await response.clone().text()).toBe(200);
    const kit = promotionKitSchema.parse(await response.json());
    const input = promotionCompositionSaveSchema.parse({
      expectedRevision: 0,
      composition: { ...kit.composition, sessionIds: [f.sessionId] },
    });
    expect(
      (
        await callApi(env, `${eventBase}/promotion/composition`, {
          method: "POST",
          headers: f.attendeeHeaders,
          body: JSON.stringify(input),
        })
      ).status,
    ).toBe(200);
    const source = await getAttendeePromotionKit(env.DB, f.eventId, f.userId, "https://pkic.org");
    expect(source.picks.map((item) => item.id)).toEqual([f.sessionId]);
    const job = await requestPromotionRender(env.DB, f.eventId, source, "portrait", "https://pkic.org");
    const changed = promotionCompositionSaveSchema.parse({
      expectedRevision: 1,
      composition: {
        ...input.composition,
        summary: "A revised personal invitation to join this event and its sessions.",
      },
    });
    expect(
      (
        await callApi(env, `${eventBase}/promotion/composition`, {
          method: "POST",
          headers: f.attendeeHeaders,
          body: JSON.stringify(changed),
        })
      ).status,
    ).toBe(200);
    let rendered = false;
    await processPromotionRenderJob(env.DB, env, job.id, async () => {
      rendered = true;
      return { body: new Uint8Array(), contentType: "image/png", count: 1 };
    });
    expect(rendered).toBe(false);
    expect(
      (
        await env.DB.prepare("SELECT status FROM event_promotion_renders WHERE id=?")
          .bind(job.id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("obsolete");
    const invalid = await callApi(env, `${eventBase}/promotion/composition`, {
      method: "POST",
      headers: f.attendeeHeaders,
      body: JSON.stringify({
        ...changed,
        expectedRevision: 2,
        composition: { ...changed.composition, sessionIds: [crypto.randomUUID()] },
      }),
    });
    expect(invalid.status).toBe(422);
  });
  it("keeps referral click, conversion and point attribution attached to an unregistered speaker", async () => {
    const f = await fixture();
    const kit = promotionKitSchema.parse(await (await callApi(env, f.sessionBase, { headers: f.headers })).json());
    const code = new URL(kit.registrationUrl).pathname.split("/").at(-1)!;
    await recordReferralClick(env.DB, { code, ip: null, userAgent: null, secret: "synthetic" });
    await recordReferralConversion(env.DB, code, { type: "registration", ref: crypto.randomUUID() });
    const result = await env.DB.prepare("SELECT clicks,conversions FROM referral_codes WHERE code=?")
      .bind(code)
      .first();
    expect(result).toMatchObject({ clicks: 1, conversions: 1 });
    expect(
      await env.DB.prepare(
        "SELECT user_id FROM engagement_events WHERE subject_ref=? AND action_type='referral_conversion'",
      )
        .bind(code)
        .first(),
    ).toMatchObject({ user_id: f.admin.id });
  });
});
