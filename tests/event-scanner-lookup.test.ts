import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import {
  scannerAttendeesResponseSchema,
  scannerAttendeeBadgeResponseSchema,
} from "../assets/shared/schemas/event-scanner-lookup";

const fixture = createEventScannerFixture();
beforeEach(() => fixture.setup());
function get(path: string, authenticated = true) {
  return callApi(env, `/api/v1/events/scan-test/scans/attendees${path}`, {
    headers: authenticated ? { authorization: `Bearer ${fixture.token}` } : {},
  });
}
describe("scanner attendee lookup through the mounted router", () => {
  it("searches registered identities and resolves only a selected active badge without creating another", async () => {
    const response = await get(`?q=${fixture.userId}&sort=email&limit=8&offset=0`);
    expect(response.status).toBe(200);
    const result = scannerAttendeesResponseSchema.parse(await response.json());
    expect(result.users.map((user) => user.id)).toEqual([fixture.userId]);
    expect(JSON.stringify(result)).not.toContain(fixture.badgeId);
    const byCode = await get(`?q=${fixture.badgeId}&sort=email&limit=8`);
    expect(scannerAttendeesResponseSchema.parse(await byCode.json()).users.map((user) => user.id)).toEqual([
      fixture.userId,
    ]);
    await env.DB.prepare("UPDATE users SET first_name='Alex',last_name='Scanner' WHERE id=?")
      .bind(fixture.userId)
      .run();
    const byName = await get("?q=Alex%20Scanner&sort=email&limit=8");
    expect(scannerAttendeesResponseSchema.parse(await byName.json()).users.map((user) => user.id)).toEqual([
      fixture.userId,
    ]);
    const badge = await get(`/${fixture.userId}/badge`);
    expect(badge.status).toBe(200);
    expect(badge.headers.get("cache-control")).toContain("no-store");
    expect(scannerAttendeeBadgeResponseSchema.parse(await badge.json()).badgeId).toBe(fixture.badgeId);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS count FROM event_badge_credentials WHERE event_id=? AND user_id=?")
          .bind(fixture.eventId, fixture.userId)
          .first<{ count: number }>()
      )?.count,
    ).toBe(1);
  });
  it("rejects anonymous requests and event-unrelated attendees", async () => {
    expect((await get("?q=example", false)).status).toBe(401);
    expect((await get(`/${crypto.randomUUID()}/badge`)).status).toBe(409);
    expect((await get("?limit=999999")).status).toBe(400);
  });
  it("does not recover revoked, expired, or canceled-registration badges", async () => {
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
      .bind(new Date().toISOString(), fixture.eventId)
      .run();
    expect((await get(`/${fixture.userId}/badge`)).status).toBe(409);
    await env.DB.prepare(
      "UPDATE event_badge_credentials SET revoked_at=NULL,expires_at='2000-01-01T00:00:00.000Z' WHERE event_id=?",
    )
      .bind(fixture.eventId)
      .run();
    expect((await get(`/${fixture.userId}/badge`)).status).toBe(409);
    await env.DB.prepare("UPDATE event_badge_credentials SET expires_at='2099-01-01T00:00:00.000Z' WHERE event_id=?")
      .bind(fixture.eventId)
      .run();
    await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=? AND user_id=?")
      .bind(fixture.eventId, fixture.userId)
      .run();
    expect((await get(`/${fixture.userId}/badge`)).status).toBe(409);
  });
  it("keeps search and selected-badge access event-scoped for a scan-only staff member", async () => {
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(fixture.operatorId).run();
    const roleId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO roles(id,name,created_at,updated_at) VALUES(?,?,?,?)")
      .bind(roleId, `Scanner ${roleId}`, new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO role_permissions(id,role_id,permission,created_at) VALUES(?,?,'agenda:attendance_record',?)",
    )
      .bind(crypto.randomUUID(), roleId, new Date().toISOString())
      .run();
    await env.DB.prepare(
      "INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,created_at) VALUES(?,?,?,'event',?,?)",
    )
      .bind(crypto.randomUUID(), fixture.operatorId, roleId, fixture.eventId, new Date().toISOString())
      .run();
    expect((await get("?q=example")).status).toBe(200);
    expect((await get(`/${fixture.userId}/badge`)).status).toBe(200);
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(fixture.operatorId).run();
    expect((await get("?q=example")).status).toBe(403);
    expect((await get(`/${fixture.userId}/badge`)).status).toBe(403);
  });
});
