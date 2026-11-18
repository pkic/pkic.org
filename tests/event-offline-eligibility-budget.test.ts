import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { enrolledOfflineEligibilityResponseSchema } from "../assets/shared/schemas/event-offline-eligibility";
import { getAgenda } from "../functions/_lib/services/event-agenda/read";
import { nowIso } from "../functions/_lib/utils/time";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { insertUser } from "./helpers/membership";
import { decryptBadgeCollectionName } from "../assets/shared/badge-collection-name";

const fixture = createEventScannerFixture();
beforeEach(fixture.setup);

function manifest(token = fixture.token, extra: Record<string, string> = {}, slug = "scan-test") {
  const query = new URLSearchParams({ epochId: fixture.epochId, deviceId: fixture.deviceId, ...extra });
  return callApi(
    env,
    `/api/v1/events/${slug}/offline-eligibility?${query}`,
    {
      headers: token ? { authorization: `Bearer ${token}` } : {},
    },
    { maxRoundTrips: 1 },
  );
}

describe("one complete D1 call for offline eligibility", () => {
  it("prepares only encrypted canonical names using the existing printed badge secret", async () => {
    const name = "Élodie 山田";
    await env.DB.prepare("UPDATE users SET first_name=?,last_name=? WHERE id=?")
      .bind("Élodie", "山田", fixture.userId)
      .run();
    const ordinary = enrolledOfflineEligibilityResponseSchema.parse(await (await manifest()).json());
    expect(ordinary.entries[0]!.encryptedName).toBeUndefined();
    const response = await manifest(fixture.token, { includeBadgeNames: "true" });
    expect(response.status).toBe(200);
    const raw = await response.text();
    expect(raw).not.toContain(name);
    expect(raw).not.toContain(fixture.badgeId);
    expect(raw).not.toContain("print_credential_json");
    const prepared = enrolledOfflineEligibilityResponseSchema.parse(JSON.parse(raw));
    expect(prepared.badgeNamesPrepared).toBe(true);
    const entry = prepared.entries[0]!;
    const binding = { eventId: fixture.eventId, badgeId: entry.badgeId, credentialHash: entry.credentialHash };
    expect(await decryptBadgeCollectionName(fixture.badgeId, binding, entry.encryptedName!)).toBe(name);
    await expect(decryptBadgeCollectionName("AAAAAAAAAAAAAAAA", binding, entry.encryptedName!)).rejects.toThrow();
    await expect(
      decryptBadgeCollectionName(fixture.badgeId, { ...binding, eventId: crypto.randomUUID() }, entry.encryptedName!),
    ).rejects.toThrow();
  });

  it("reports partial offline name coverage when a badge secret is unavailable", async () => {
    await env.DB.prepare("UPDATE users SET first_name='Synthetic',last_name='Attendee' WHERE id=?")
      .bind(fixture.userId)
      .run();
    await env.DB.prepare("UPDATE event_badge_credentials SET print_credential_json=NULL WHERE event_id=?")
      .bind(fixture.eventId)
      .run();
    const partial = enrolledOfflineEligibilityResponseSchema.parse(
      await (await manifest(fixture.token, { includeBadgeNames: "true" })).json(),
    );
    expect(partial).toMatchObject({ badgeNamesPrepared: false, badgeNamesUnavailable: 1 });
    expect(partial.entries[0]!.encryptedName).toBeUndefined();
    expect((await manifest("", { includeBadgeNames: "true" })).status).toBe(401);
  });

  it("withholds previously available encrypted names after canonical redaction", async () => {
    await env.DB.prepare("UPDATE users SET first_name='Synthetic',last_name='Attendee' WHERE id=?")
      .bind(fixture.userId)
      .run();
    const available = enrolledOfflineEligibilityResponseSchema.parse(
      await (await manifest(fixture.token, { includeBadgeNames: "true" })).json(),
    );
    const entry = available.entries[0]!;
    expect(available).toMatchObject({ badgeNamesPrepared: true, badgeNamesUnavailable: 0 });
    expect(
      await decryptBadgeCollectionName(
        fixture.badgeId,
        { eventId: fixture.eventId, badgeId: entry.badgeId, credentialHash: entry.credentialHash },
        entry.encryptedName!,
      ),
    ).toBe("Synthetic Attendee");
    await env.DB.prepare("UPDATE users SET pii_redacted_at=? WHERE id=?").bind(nowIso(), fixture.userId).run();
    const redacted = enrolledOfflineEligibilityResponseSchema.parse(
      await (await manifest(fixture.token, { includeBadgeNames: "true" })).json(),
    );
    expect(redacted).toMatchObject({ badgeNamesPrepared: false, badgeNamesUnavailable: 1 });
    expect(redacted.entries[0]!.encryptedName).toBeUndefined();
  });

  it("keeps encrypted name refreshes unchanged until the canonical name changes", async () => {
    await env.DB.prepare("UPDATE users SET first_name='First',last_name='Attendee' WHERE id=?")
      .bind(fixture.userId)
      .run();
    const first = enrolledOfflineEligibilityResponseSchema.parse(
      await (await manifest(fixture.token, { includeBadgeNames: "true" })).json(),
    );
    const refreshed = enrolledOfflineEligibilityResponseSchema.parse(
      await (
        await manifest(fixture.token, {
          includeBadgeNames: "true",
          knownDigest: first.pageDigest,
        })
      ).json(),
    );
    expect(refreshed).toMatchObject({ unchanged: true, pageDigest: first.pageDigest, entries: [] });
    await env.DB.prepare("UPDATE users SET first_name='Corrected' WHERE id=?").bind(fixture.userId).run();
    const changed = enrolledOfflineEligibilityResponseSchema.parse(
      await (
        await manifest(fixture.token, {
          includeBadgeNames: "true",
          knownDigest: first.pageDigest,
        })
      ).json(),
    );
    expect(changed.unchanged).toBe(false);
    expect(changed.pageDigest).not.toBe(first.pageDigest);
    const entry = changed.entries[0]!;
    expect(
      await decryptBadgeCollectionName(
        fixture.badgeId,
        { eventId: fixture.eventId, badgeId: entry.badgeId, credentialHash: entry.credentialHash },
        entry.encryptedName!,
      ),
    ).toBe("Corrected Attendee");
  });

  it("refuses encrypted names to operators holding only lead capture permission", async () => {
    const leadUser = await insertUser(env.DB);
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:leads_capture','event',?,?)",
    )
      .bind(crypto.randomUUID(), leadUser, fixture.eventId, nowIso())
      .run();
    const token = await createAdminSession(env.DB, leadUser, crypto.randomUUID());
    expect((await manifest(token, { includeBadgeNames: "true" })).status).toBe(403);
  });

  it("keeps badge evidence private to a live authorized operator's open enrolled device and event", async () => {
    const read = await manifest();
    expect(read.status).toBe(200);
    const evidence = enrolledOfflineEligibilityResponseSchema.parse(await read.json()).entries[0]!;
    expect((await manifest("")).status).toBe(401);

    const other = await insertUser(env.DB);
    const grantId = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:check','event',?,?)",
    )
      .bind(grantId, other, fixture.eventId, nowIso())
      .run();
    const otherToken = await createAdminSession(env.DB, other, crypto.randomUUID());
    const notOwner = await manifest(otherToken);
    expect(notOwner.status).toBe(403);
    expect(await notOwner.text()).not.toContain(evidence.credentialHash);
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE id=?").bind(nowIso(), grantId).run();
    expect((await manifest(otherToken)).status).toBe(403);

    const foreignEvent = crypto.randomUUID();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,'other-manifest','Other','UTC',?,?)",
    )
      .bind(foreignEvent, nowIso(), nowIso())
      .run();
    const wrongEvent = await manifest(fixture.token, {}, "other-manifest");
    expect(wrongEvent.status).toBe(409);
    expect(await wrongEvent.text()).not.toContain(evidence.credentialHash);
    expect((await manifest(fixture.token, { deviceId: crypto.randomUUID() })).status).toBe(409);

    await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?").bind(nowIso(), fixture.operatorId).run();
    const revoked = await manifest();
    expect(revoked.status).toBe(401);
    expect(await revoked.text()).not.toContain(evidence.credentialHash);
  });

  it.each([false, true])(
    "reports actual session closure independently from enrollment and ownership (closed: %s)",
    async (closed) => {
      await env.DB.prepare(
        "UPDATE event_scanner_device_sessions SET high_water_sequence=0,closing_operation_id=?,closing_declared_at=?,closed_at=? WHERE id=?",
      )
        .bind(crypto.randomUUID(), nowIso(), closed ? nowIso() : null, fixture.epochId)
        .run();
      const response = await manifest();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: closed ? "SCANNER_PREPARATION_CLOSED" : "SCANNER_PREPARATION_CLOSING" },
      });
    },
  );

  it.each(["capture_closed_at", "active_run_id"] as const)(
    "refuses evidence while retention fences %s",
    async (column) => {
      await env.DB.prepare(
        `INSERT INTO event_evidence_retention_state(event_id,${column}) VALUES(?,?) ON CONFLICT(event_id) DO UPDATE SET ${column}=excluded.${column}`,
      )
        .bind(fixture.eventId, column === "capture_closed_at" ? nowIso() : crypto.randomUUID())
        .run();
      const response = await manifest();
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "SCANNER_CAPTURE_CLOSED" } });
    },
  );

  it.each([
    ["Pacific/Kiritimati", "2026-10-25T10:30:00.000Z", "2026-10-26", "2026-10-25"],
    ["America/Los_Angeles", "2026-10-25T00:30:00.000Z", "2026-10-24", "2026-10-25"],
    ["Europe/Amsterdam", "2026-10-25T00:30:00.000Z", "2026-10-25", "2026-10-24"],
    ["Europe/Amsterdam", "2026-10-25T01:30:00.000Z", "2026-10-25", "2026-10-24"],
  ])("uses the exact local attendance date in %s at %s", async (timeZone, startAt, localDay, adjacentDay) => {
    const snapshot = await getAgenda(env.DB, fixture.eventId, "scan-test");
    snapshot.timeZone = timeZone;
    snapshot.occurrences[0]!.startAt = startAt;
    snapshot.occurrences[0]!.endAt = new Date(Date.parse(startAt) + 3600000).toISOString();
    await env.DB.prepare("UPDATE event_agenda_publications SET snapshot_json=? WHERE event_id=? AND revision=0")
      .bind(JSON.stringify(snapshot), fixture.eventId)
      .run();
    const days = [crypto.randomUUID(), crypto.randomUUID()];
    const registration = await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
      .bind(fixture.eventId, fixture.userId)
      .first<{ id: string }>();
    for (const [index, date] of [localDay, adjacentDay].entries()) {
      await env.DB.prepare("INSERT INTO event_days(id,event_id,day_date,created_at,updated_at) VALUES(?,?,?,?,?)")
        .bind(days[index], fixture.eventId, date, nowIso(), nowIso())
        .run();
      await env.DB.prepare(
        "INSERT INTO registration_day_attendance(id,registration_id,event_day_id,attendance_type,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      )
        .bind(
          crypto.randomUUID(),
          registration!.id,
          days[index],
          index === 0 ? "virtual" : "in_person",
          nowIso(),
          nowIso(),
        )
        .run();
    }
    const read = async () => {
      const response = await manifest(fixture.token, { occurrenceId: fixture.occurrenceId });
      expect(response.status, await response.clone().text()).toBe(200);
      return enrolledOfflineEligibilityResponseSchema.parse(await response.json());
    };
    expect((await read()).entries[0]).toMatchObject({ eventRegistered: true, physicalDayEligible: false });
    await env.DB.prepare(
      "UPDATE registration_day_attendance SET attendance_type='in_person' WHERE registration_id=? AND event_day_id=?",
    )
      .bind(registration!.id, days[0])
      .run();
    expect((await read()).entries[0]).toMatchObject({ physicalDayEligible: true });
    await env.DB.prepare("DELETE FROM registration_day_attendance WHERE registration_id=? AND event_day_id=?")
      .bind(registration!.id, days[0])
      .run();
    expect((await read()).entries[0]).toMatchObject({ physicalDayEligible: false });
  });
});
