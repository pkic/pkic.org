import { scannerPermission } from "../assets/shared/event-scanner-permissions";
import { hasPermission, preparePermissionsAuthorizationGuard } from "../functions/_lib/auth/permissions";
import type { AuthAdmin } from "../functions/_lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { offlineEligibility } from "../functions/_lib/services/event-participation/offline-eligibility";

const fixture = createEventScannerFixture();
const { eventId, operatorId, scanBody, scan } = fixture;
describe("Independent scanner capabilities and badge expiry", () => {
  beforeEach(fixture.setup);
  it("keeps delegated token restrictions authoritative for legacy grants", () => {
    const actor = {
      scopeRestricted: true,
      scopes: ["agenda:check"],
      grants: [{ permission: "agenda:scan", contextType: "event", contextId: "one" }],
    } as AuthAdmin;
    expect(
      scannerPermission((value) => hasPermission(actor, value, { type: "event", id: "one" }), "agenda:check"),
    ).toBe("agenda:check");
    expect(
      scannerPermission((value) => hasPermission(actor, value, { type: "event", id: "one" }), "agenda:admit"),
    ).toBeNull();
    actor.scopes = ["agenda:scan"];
    expect(
      scannerPermission((value) => hasPermission(actor, value, { type: "event", id: "one" }), "agenda:admit"),
    ).toBe("agenda:admit");
    expect(
      scannerPermission((value) => hasPermission(actor, value, { type: "event", id: "two" }), "agenda:admit"),
    ).toBeNull();
  });
  it("guards legacy authority narrowed to check by a delegated token and rejects a revocation race", async () => {
    await env.DB.prepare(
      `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE user_id=? AND role_id='role-admin'
        AND context_type IS NULL AND context_id IS NULL AND revoked_at IS NULL`,
    )
      .bind(operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:scan','event',?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, eventId, new Date().toISOString())
      .run();
    const actor = {
      identityType: "user",
      id: operatorId,
      email: "operator@example.test",
      scopeRestricted: true,
      scopes: ["agenda:check"],
      grants: [{ permission: "agenda:scan", contextType: "event", contextId: eventId }],
    } as AuthAdmin;
    const context = { type: "event", id: eventId };
    expect(hasPermission(actor, "agenda:check", context)).toBe(true);
    expect(hasPermission(actor, "agenda:admit", context)).toBe(false);
    await env.DB.batch([
      preparePermissionsAuthorizationGuard(env.DB, actor, [{ permission: "agenda:check", context }]),
    ]);
    await expect(
      env.DB.batch([preparePermissionsAuthorizationGuard(env.DB, actor, [{ permission: "agenda:admit", context }])]),
    ).rejects.toThrow();
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), operatorId)
      .run();
    await expect(
      env.DB.batch([
        preparePermissionsAuthorizationGuard(env.DB, actor, [{ permission: "agenda:check", context }]),
        env.DB.prepare("UPDATE events SET name='Unauthorized' WHERE id=?").bind(eventId),
      ]),
    ).rejects.toThrow();
    expect(await env.DB.prepare("SELECT name FROM events WHERE id=?").bind(eventId).first()).toEqual({
      name: "Scan test",
    });
  });
  it("rejects expired recognized badges while preserving their attempt evidence", async () => {
    await env.DB.prepare("UPDATE event_badge_credentials SET expires_at=? WHERE event_id=?")
      .bind(new Date(Date.parse(fixture.observedAt) - 1000).toISOString(), eventId)
      .run();
    const response = await scan(scanBody({ action: "check" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "denied", reason: "expired_badge", recorded: true });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 0,
    });
    const manifest = await offlineEligibility(env.DB, eventId, operatorId, {});
    expect(manifest.entries[0]?.expiresAt).toBeTruthy();
  });
  it("does not retroactively expire a badge captured before its expiry when uploaded later", async () => {
    const captured = scanBody({ action: "check" });
    const expiry = new Date(Date.parse(captured.observedAt) + 1000).toISOString();
    await env.DB.prepare("UPDATE event_badge_credentials SET expires_at=? WHERE event_id=?")
      .bind(expiry, eventId)
      .run();
    const response = await scan(captured);
    expect(response.status).toBe(200);
    const receipt = await response.json();
    expect(receipt).toMatchObject({ recorded: true });
    expect(receipt).not.toMatchObject({ outcome: "denied", reason: "expired_badge" });
    expect(
      await env.DB.prepare("SELECT observed_at FROM event_scan_attempts WHERE operation_id=?")
        .bind(captured.operationId)
        .first(),
    ).toEqual({ observed_at: captured.observedAt });
  });
  it("prioritizes revoked badge status over expiration and absent registration", async () => {
    const expired = new Date(Date.parse(fixture.observedAt) - 1000).toISOString();
    await env.DB.prepare("UPDATE event_badge_credentials SET expires_at=?,revoked_at=? WHERE event_id=?")
      .bind(expired, expired, eventId)
      .run();
    await env.DB.prepare("DELETE FROM registrations WHERE event_id=?").bind(eventId).run();
    const response = await scan(scanBody({ action: "check" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ outcome: "denied", reason: "revoked_badge", recorded: true });
  });
  it("keeps check and admission grants independent and enforces revocation", async () => {
    await env.DB.prepare(
      `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE user_id=? AND role_id='role-admin'
        AND context_type IS NULL AND context_id IS NULL AND revoked_at IS NULL`,
    )
      .bind(operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:check','event',?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, eventId, new Date().toISOString())
      .run();
    expect((await scan(scanBody({ action: "check" }))).status).toBe(200);
    expect((await scan(scanBody({ action: "admission" }))).status).toBe(403);
    expect((await scan(scanBody({ action: "attendance" }))).status).toBe(403);
    await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE user_id=?")
      .bind(new Date().toISOString(), operatorId)
      .run();
    expect((await scan(scanBody({ action: "check" }))).status).toBe(401);
  });
  it("does not allow admission-only operators to opt into exception attendance", async () => {
    await env.DB.prepare(
      `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE user_id=? AND role_id='role-admin'
        AND context_type IS NULL AND context_id IS NULL AND revoked_at IS NULL`,
    )
      .bind(operatorId)
      .run();
    for (const permission of ["agenda:admit", "agenda:admit_exceptions"])
      await env.DB.prepare(
        "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,'event',?,?)",
      )
        .bind(crypto.randomUUID(), operatorId, permission, eventId, new Date().toISOString())
        .run();
    expect(
      (await scan(scanBody({ action: "exception", exceptionReason: "organizer_approval", recordAttendance: true })))
        .status,
    ).toBe(403);
    expect((await scan(scanBody({ action: "exception", exceptionReason: "organizer_approval" }))).status).toBe(200);
  });
});
