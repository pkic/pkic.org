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
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const admin = (await env.DB.prepare("SELECT id,email FROM users WHERE email='admin@pkic.org'").first<{
    id: string;
    email: string;
  }>())!;
  const headers = {
    authorization: `Bearer ${await createAdminSession(env.DB, admin.id, "promotion-admin")}`,
    "content-type": "application/json",
  };
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
      speakerUserIds: [admin.id],
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
    headers,
    userId,
    attendeeHeaders,
    sessionId,
    sessionBase: `${eventBase}/agenda/occurrences/${sessionId}/promotion`,
  };
}
describe("personal event promotion kits", () => {
  beforeEach(() => resetDb());
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
