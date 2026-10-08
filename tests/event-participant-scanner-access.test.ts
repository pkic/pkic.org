import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { eventDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { insertUser } from "./helpers/membership";
import { createAdminSession } from "./helpers/auth";
import { callApi } from "./helpers/app";

const f = createEventScannerFixture();
let userId: string;
let token: string;
async function grant(permission: string, contextType: string, contextId: string) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(id, userId, permission, contextType, contextId, new Date().toISOString())
    .run();
  return id;
}
async function sponsor(name: string) {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,contact_email,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,?,?,'active',?,?)",
  )
    .bind(id, f.eventId, name, "private-contact@example.test", now, now)
    .run();
  return id;
}
async function detail() {
  const response = await callApi(env, "/api/v1/events/scan-test", { headers: { authorization: `Bearer ${token}` } });
  expect(response.status).toBe(200);
  return eventDetailResponseSchema.parse(await response.json()).event;
}
beforeEach(async () => {
  await f.setup();
  userId = await insertUser(env.DB);
  token = await createAdminSession(env.DB, userId, crypto.randomUUID());
  await grant("events:read", "event", f.eventId);
  const now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
  )
    .bind(crypto.randomUUID(), f.eventId, userId, crypto.randomUUID(), now, now)
    .run();
});

describe("attendee scanner discovery on the management projection", () => {
  it("does not grant capture from management or attendee standing", async () => {
    const event = await detail();
    expect("capabilities" in event).toBe(true);
    expect(event.participation?.registrationStatus).toBe("registered");
    expect(event.scannerAccess).toBeUndefined();
  });
  it("preserves dual capture permissions, all sponsor choices and fresh revocation independently", async () => {
    const first = await sponsor("First sponsor"),
      second = await sponsor("Second sponsor");
    const badgeGrant = await grant("agenda:attendance_record", "event", f.eventId);
    const leadGrant = await grant("agenda:leads_capture", "event_sponsor", first);
    await grant("agenda:leads_capture", "event_sponsor", second);
    let event = await detail();
    expect("capabilities" in event).toBe(true);
    expect(event.scannerAccess).toEqual({
      canScan: true,
      sponsors: [
        { id: first, name: "First sponsor" },
        { id: second, name: "Second sponsor" },
      ],
    });
    expect(JSON.stringify(event.scannerAccess)).not.toContain("private-contact");
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), leadGrant)
      .run();
    event = await detail();
    expect(event.scannerAccess).toEqual({ canScan: true, sponsors: [{ id: second, name: "Second sponsor" }] });
    await env.DB.prepare("UPDATE sponsorships SET pipeline_stage='lapsed' WHERE id=?").bind(second).run();
    expect((await detail()).scannerAccess).toEqual({ canScan: true, sponsors: [] });
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), badgeGrant)
      .run();
    expect((await detail()).scannerAccess).toBeUndefined();
  });
});
