import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  enrolledOfflineEligibilityQuerySchema,
  enrolledOfflineEligibilityResponseSchema,
  type OfflineEligibilityQuery,
} from "../assets/shared/schemas/event-offline-eligibility";
import { callApi } from "./helpers/app";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { setSessionParticipation } from "../functions/_lib/services/event-participation/session-booking";

const fixture = createEventScannerFixture();
async function download(query: OfflineEligibilityQuery = {}) {
  const parsed = enrolledOfflineEligibilityQuerySchema.parse({
    ...query,
    epochId: fixture.epochId,
    deviceId: fixture.deviceId,
  });
  const search = new URLSearchParams(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
  const response = await callApi(
    env,
    `/api/v1/events/scan-test/offline-eligibility?${search}`,
    {
      headers: { authorization: `Bearer ${fixture.token}` },
    },
    { maxRoundTrips: 1 },
  );
  expect(response.status).toBe(200);
  return enrolledOfflineEligibilityResponseSchema.parse(await response.json());
}
function since(manifest: Awaited<ReturnType<typeof download>>): OfflineEligibilityQuery {
  return {
    knownDigest: manifest.pageDigest,
    scopeDate: manifest.scopeDate,
    ...(manifest.occurrenceId ? { occurrenceId: manifest.occurrenceId } : {}),
    publishedRevision: manifest.publishedRevision ?? undefined,
  };
}

describe("Conditional scanner eligibility", () => {
  beforeEach(() => fixture.setup());

  it("renews an unchanged snapshot without downloading the badge inventory again", async () => {
    const first = await download();
    expect(first.entries).toHaveLength(1);
    const unchanged = await download(since(first));
    expect(unchanged.entries).toEqual([]);
    expect(unchanged.unchanged).toBe(true);
    expect(unchanged.pageDigest).toBe(first.pageDigest);
  });

  it.each(["revocation", "registration", "day selection"])("refreshes the page after %s changes", async (kind) => {
    const first = await download();
    const statement =
      kind === "revocation"
        ? "UPDATE event_badge_credentials SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE event_id=?"
        : kind === "registration"
          ? "UPDATE registrations SET status='cancelled' WHERE event_id=?"
          : "UPDATE registration_day_attendance SET attendance_type='virtual' WHERE registration_id IN(SELECT id FROM registrations WHERE event_id=?)";
    await env.DB.prepare(statement).bind(fixture.eventId).run();
    const changed = await download(since(first));
    expect(changed.pageDigest).not.toBe(first.pageDigest);
    expect(changed.unchanged).toBe(false);
    expect(changed.entries).toHaveLength(1);
    expect(changed.entries[0]).toMatchObject(
      kind === "revocation"
        ? { revoked: true }
        : kind === "registration"
          ? { eventRegistered: false }
          : { physicalDayEligible: false },
    );
    expect((await download(since(changed))).entries).toEqual([]);
  });

  it("includes session bookings and cancellations in the page fingerprint", async () => {
    const first = await download({ occurrenceId: fixture.occurrenceId });
    expect(first.entries[0]?.sessionEligible).toBe(false);
    await setSessionParticipation(env.DB, fixture.eventId, fixture.occurrenceId, fixture.userId, {
      action: "reserve",
      attendanceMode: "physical",
    });
    const reserved = await download(since(first));
    expect(reserved.entries[0]?.sessionEligible).toBe(true);
    await env.DB.prepare("DELETE FROM agenda_session_participations WHERE event_id=?").bind(fixture.eventId).run();
    expect((await download(since(reserved))).entries[0]?.sessionEligible).toBe(false);
  });

  it("detects a deleted badge without retaining a tombstone or attendee identity", async () => {
    const first = await download();
    await env.DB.prepare("DELETE FROM event_badge_credentials WHERE event_id=?").bind(fixture.eventId).run();
    const changed = await download(since(first));
    expect(changed.entries).toEqual([]);
    expect(changed.unchanged).toBe(false);
    expect(changed.pageDigest).not.toBe(first.pageDigest);
    expect(JSON.stringify(changed)).not.toContain(first.entries[0]!.credentialHash);
    expect(JSON.stringify(changed)).not.toContain(fixture.userId);
  });

  it("pages 1000 badges without an ID list and conditionally omits unchanged pages", async () => {
    const ids = Array.from({ length: 999 }, () => crypto.randomUUID());
    await env.DB.prepare(`INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at)
      SELECT value,?,?,replace(value,'-','')||replace(value,'-',''),? FROM json_each(?)`)
      .bind(fixture.eventId, fixture.userId, new Date().toISOString(), JSON.stringify(ids))
      .run();
    const page1 = await download();
    const page2 = await download({ afterBadgeId: page1.nextBadgeId! });
    const page3 = await download({ afterBadgeId: page2.nextBadgeId! });
    expect(page1.entries).toHaveLength(250);
    expect(page2.entries).toHaveLength(250);
    const page4 = await download({ afterBadgeId: page3.nextBadgeId! });
    expect(page3.entries).toHaveLength(250);
    expect(page4.entries).toHaveLength(250);
    expect(page4.nextBadgeId).toBeNull();
    expect(
      new Set([...page1.entries, ...page2.entries, ...page3.entries, ...page4.entries].map((entry) => entry.badgeId))
        .size,
    ).toBe(1000);
    const omitted = await download({ ...since(page2), afterBadgeId: page1.nextBadgeId! });
    expect(omitted.entries).toEqual([]);
    expect(omitted.unchanged).toBe(true);
    expect(omitted.nextBadgeId).toBe(page2.nextBadgeId);
    expect(new TextEncoder().encode(JSON.stringify(omitted)).byteLength).toBeLessThan(2000);
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), page2.entries[0]!.badgeId)
      .run();
    const changed = await download({ ...since(page2), afterBadgeId: page1.nextBadgeId! });
    expect(changed.unchanged).toBe(false);
    expect(changed.entries[0]!.revoked).toBe(true);
  });

  it("rejects a changed date or publication during pagination", async () => {
    const first = await download();
    for (const query of [
      { ...since(first), publishedRevision: 999 },
      { ...since(first), scopeDate: "2000-01-01" },
    ]) {
      const search = new URLSearchParams(
        Object.entries({ ...query, epochId: fixture.epochId, deviceId: fixture.deviceId })
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      );
      const response = await callApi(
        env,
        `/api/v1/events/scan-test/offline-eligibility?${search}`,
        {
          headers: { authorization: `Bearer ${fixture.token}` },
        },
        { maxRoundTrips: 1 },
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "OFFLINE_MANIFEST_CHANGED" } });
    }
  });

  it("keeps the same fingerprint after a rolled-back business mutation", async () => {
    const first = await download();
    await expect(
      env.DB.batch([
        env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE event_id=?").bind(fixture.eventId),
        env.DB.prepare(
          "INSERT INTO registrations(id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at) VALUES(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)",
        ),
      ]),
    ).rejects.toThrow();
    const current = await download(since(first));
    expect(current.pageDigest).toBe(first.pageDigest);
    expect(current.unchanged).toBe(true);
    expect(current.entries).toEqual([]);
  });
});
