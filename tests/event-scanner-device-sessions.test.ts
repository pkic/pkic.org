import { profileD1Flow } from "./helpers/d1-flow-profile";
import { generateBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { callApi } from "./helpers/app";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import {
  scannerDeviceSessionStatusSchema,
  scannerDeviceSessionEnrollmentResponseSchema,
} from "../assets/shared/schemas/event-scanner-devices";
import {
  enrolledEventScanRequestSchema,
  eventScanResponseSchema,
} from "../assets/shared/schemas/event-participation-scanning";

const fixture = createEventScannerFixture();
function request(path: string, body?: unknown, authenticated = true) {
  return callApi(env, `/api/v1/events/scan-test/scanner/devices/sessions${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      ...(authenticated ? { authorization: `Bearer ${fixture.token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe("Scanner device enrollment and immutable upload closing barrier", () => {
  beforeEach(fixture.setup);
  it("acknowledges a recognized enrolled scan through the mounted route with a bounded number of D1 trips", async () => {
    const profile = profileD1Flow(env.DB);
    const body = enrolledEventScanRequestSchema.parse(fixture.scanBody({ capturePublicationRevision: 0 }));
    const response = await callApi({ ...env, DB: profile.db }, "/api/v1/events/scan-test/scans", {
      method: "POST",
      headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    const result = eventScanResponseSchema.parse(await response.json());
    expect(result.scannerReceipt).toMatchObject({
      operationId: body.operationId,
      sequence: body.scannerSession.sequence,
    });
    expect(result.recorded).toBe(true);
    expect(result.outcome).toBe("warning");
    // New captures retain the primary command after preflight; this remains above the one-call target.
    expect((await profile.report()).roundTrips).toBe(2);
    const replay = await callApi(
      env,
      "/api/v1/events/scan-test/scans",
      {
        method: "POST",
        headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      { maxRoundTrips: 1 },
    );
    expect(replay.status).toBe(200);
    expect(eventScanResponseSchema.parse(await replay.json())).toEqual(result);
  });
  it("enrolls idempotently and requires authenticated enrolled new uploads", async () => {
    const body = { operationId: crypto.randomUUID(), deviceId: crypto.randomUUID() };
    expect((await request("", body, false)).status).toBe(401);
    const first = await request("", body);
    expect(first.status).toBe(200);
    const enrolled = scannerDeviceSessionEnrollmentResponseSchema.parse(await first.clone().json());
    const status = scannerDeviceSessionStatusSchema.parse(await (await request(`/${enrolled.epochId}`)).json());
    expect(status).toMatchObject({
      epochId: enrolled.epochId,
      deviceId: body.deviceId,
      enrollmentOperationId: body.operationId,
      openedAt: enrolled.openedAt,
    });
    expect(await (await request("", body)).json()).toEqual(await first.json());
    expect((await request("", { ...body, deviceId: crypto.randomUUID() })).status).toBe(409);
    const scan = fixture.scanBody();
    const { scannerSession: _session, ...legacy } = scan;
    expect((await fixture.scan(legacy)).status).toBe(400);
  });
  it("requires the original open enrolled device on every manifest preparation page", async () => {
    const path = "/api/v1/events/scan-test/offline-eligibility";
    const headers = { authorization: `Bearer ${fixture.token}` };
    expect((await callApi(env, path, { headers }, { maxRoundTrips: 1 })).status).toBe(400);
    const query = new URLSearchParams({ epochId: fixture.epochId, deviceId: fixture.deviceId });
    const profile = profileD1Flow(env.DB);
    const valid = await callApi({ ...env, DB: profile.db }, `${path}?${query}`, { headers }, { maxRoundTrips: 1 });
    expect(valid.status).toBe(200);
    expect((await profile.report()).executedSql.every((sql) => !/^\s*(?:INSERT|UPDATE|DELETE)/u.test(sql))).toBe(true);
    expect(await valid.json()).toMatchObject({
      epochId: fixture.epochId,
      deviceId: fixture.deviceId,
      operatorUserId: fixture.operatorId,
    });
    expect(
      (
        await callApi(
          env,
          `${path}?${new URLSearchParams({ epochId: fixture.epochId, deviceId: crypto.randomUUID() })}`,
          { headers },
          { maxRoundTrips: 1 },
        )
      ).status,
    ).toBe(409);
    await request(`/${fixture.epochId}/closing`, {
      operationId: crypto.randomUUID(),
      highWaterSequence: 0,
      pendingCount: 0,
      recoveryCount: 0,
    });
    expect((await callApi(env, `${path}?${query}`, { headers }, { maxRoundTrips: 1 })).status).toBe(409);
  });
  it("receipts unknown credentials without attendee data and closes their uploaded sequence", async () => {
    const body = fixture.scanBody({ badgeId: generateBadgeCredential() });
    const response = await fixture.scan(body);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({
      outcome: "unknown",
      recorded: true,
      scannerReceipt: { epochId: body.scannerSession.epochId, sequence: 1, operationId: body.operationId },
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scan_attempts").first()).toEqual({ count: 1 });
    const closed = await request(`/${body.scannerSession.epochId}/closing`, {
      operationId: crypto.randomUUID(),
      highWaterSequence: 1,
      pendingCount: 0,
      recoveryCount: 0,
    });
    expect(await closed.json()).toMatchObject({
      highWaterSequence: 1,
      receivedCount: 1,
      missingCount: 0,
      closedAt: expect.any(String),
    });
    expect(await (await fixture.scan(body)).json()).toEqual(receipt);
    expect((await fixture.scan({ ...body, badgeId: generateBadgeCredential() })).status).toBe(409);
    const stored = await env.DB.prepare("SELECT response_json FROM event_scanner_upload_receipts").first<{
      response_json: string;
    }>();
    expect(stored!.response_json).not.toContain(body.badgeId);
    expect(stored!.response_json).not.toContain(fixture.userId);
  });
  it("freezes the declared high water and requires every issued sequence even when received counts are plausible", async () => {
    const first = fixture.scanBody({ badgeId: generateBadgeCredential() });
    const second = fixture.scanBody({ badgeId: generateBadgeCredential() });
    expect((await fixture.scan(second)).status).toBe(200);
    const declaration = { operationId: crypto.randomUUID(), highWaterSequence: 2, pendingCount: 0, recoveryCount: 0 };
    expect(await (await request(`/${first.scannerSession.epochId}/closing`, declaration)).json()).toMatchObject({
      receivedCount: 1,
      missingCount: 1,
      closedAt: null,
    });
    expect((await fixture.scan(fixture.scanBody())).status).toBe(409);
    expect((await fixture.scan(first)).status).toBe(200);
    expect(await (await request(`/${first.scannerSession.epochId}/closing`, declaration)).json()).toMatchObject({
      receivedCount: 2,
      missingCount: 0,
      closedAt: expect.any(String),
    });
    expect(
      (await request(`/${first.scannerSession.epochId}/closing`, { ...declaration, highWaterSequence: 3 })).status,
    ).toBe(409);
  });
  it("closes an explicitly enrolled empty epoch without equating zero grants with event completeness", async () => {
    const enrollment = (await (
      await request("", { operationId: crypto.randomUUID(), deviceId: crypto.randomUUID() })
    ).json()) as { epochId: string };
    expect(
      await (
        await request(`/${enrollment.epochId}/closing`, {
          operationId: crypto.randomUUID(),
          highWaterSequence: 0,
          pendingCount: 0,
          recoveryCount: 0,
        })
      ).json(),
    ).toMatchObject({ receivedCount: 0, missingCount: 0, closedAt: expect.any(String) });
  });
  it("keeps new receipt allocation flags false when historical admission already exists", async () => {
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO event_session_admissions(id,event_id,occurrence_id,user_id,operation_id,admitted_at) VALUES(?,?,?,?,?,?)",
      ).bind(crypto.randomUUID(), fixture.eventId, fixture.occurrenceId, fixture.userId, crypto.randomUUID(), now),
      env.DB.prepare(
        "INSERT INTO agenda_session_participations(id,event_id,occurrence_id,user_id,attendance_mode,status,created_at,updated_at) VALUES(?,?,?,?,'physical','reserved',?,?)",
      ).bind(crypto.randomUUID(), fixture.eventId, fixture.occurrenceId, fixture.userId, now, now),
    ]);
    const body = fixture.scanBody();
    const first = await fixture.scan(body);
    expect(first.status, await first.clone().text()).toBe(200);
    const receipt = await first.json();
    expect(receipt).toMatchObject({
      outcome: "eligible",
      recorded: true,
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    const replay = await fixture.scan(body);
    expect(replay.status, await replay.clone().text()).toBe(200);
    expect(await replay.json()).toEqual(receipt);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_session_admissions").first()).toEqual({
      count: 1,
    });
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scanner_upload_receipts").first()).toEqual({
      count: 1,
    });
  });
  it.each(["epoch", "permission", "session"] as const)(
    "rolls back the mounted capture when %s closes between preflight and commit",
    async (change) => {
      const body = enrolledEventScanRequestSchema.parse(fixture.scanBody());
      let applied = false;
      const raced = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("INSERT INTO event_scanner_upload_guards"),
        async () => {
          applied = true;
          if (change === "epoch")
            await env.DB.prepare(
              "UPDATE event_scanner_device_sessions SET high_water_sequence=0,closing_operation_id=?,closing_declared_at=?,closed_at=? WHERE id=?",
            )
              .bind(
                crypto.randomUUID(),
                new Date().toISOString(),
                new Date().toISOString(),
                body.scannerSession.epochId,
              )
              .run();
          else if (change === "permission")
            await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=?")
              .bind(new Date().toISOString(), fixture.operatorId)
              .run();
          else
            await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
              .bind(new Date().toISOString(), fixture.operatorId)
              .run();
        },
      );
      const response = await callApi({ ...env, DB: raced }, "/api/v1/events/scan-test/scans", {
        method: "POST",
        headers: { authorization: `Bearer ${fixture.token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(applied).toBe(true);
      expect(response.status).toBe(change === "epoch" ? 409 : 403);
      expect(await response.json()).toMatchObject({
        error: { code: change === "epoch" ? "SCANNER_SESSION_CLOSED" : "SCAN_PERMISSION_CHANGED" },
      });
      expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scan_attempts").first()).toEqual({ count: 0 });
      expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_attendance_observations").first()).toEqual({
        count: 0,
      });
      expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_scanner_upload_receipts").first()).toEqual({
        count: 0,
      });
    },
  );
});
