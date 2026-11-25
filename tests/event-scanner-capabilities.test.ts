import { scannerPermission } from "../assets/shared/event-scanner-permissions";
import {
  computeGrantsForUser,
  findUserPermissionRecipients,
  hasPermission,
  preparePermissionsAuthorizationGuard,
} from "../functions/_lib/auth/permissions";
import { listPermissionHolders } from "../functions/_lib/auth/permission-holders";
import { EVENT_TEAM_ROLE_IDS } from "../assets/shared/schemas/event-team";
import { eventDetailResponseSchema } from "../assets/shared/schemas/event-management";
import { callApi } from "./helpers/app";
import type { AuthAdmin } from "../functions/_lib/types";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";

import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { offlineEligibility } from "../functions/_lib/services/event-participation/offline-eligibility";

const fixture = createEventScannerFixture();
const { eventId, operatorId, scanBody, scan } = fixture;
describe("Independent scanner capabilities and badge expiry", () => {
  beforeEach(fixture.setup);
  it("lets the check-in roles scan and prepare offline data only for their own event", async () => {
    await env.DB.prepare(
      `UPDATE user_roles SET revoked_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
       WHERE user_id=? AND role_id='role-admin' AND revoked_at IS NULL`,
    )
      .bind(operatorId)
      .run();
    const context = { type: "event", id: eventId } as const;
    const manifestUrl = `/api/v1/events/scan-test/offline-eligibility?${new URLSearchParams({
      epochId: fixture.epochId,
      deviceId: fixture.deviceId,
    })}`;
    const headers = { authorization: `Bearer ${fixture.token}` };
    const globalOrganizerId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO user_roles(id,user_id,role_id,created_at) VALUES(?,?,'role-event_organizer',?)")
      .bind(globalOrganizerId, operatorId, new Date().toISOString())
      .run();

    expect((await callApi(env, manifestUrl, { headers })).status).toBe(403);
    const globalDetail = await callApi(env, "/api/v1/events/scan-test", { headers });
    expect(eventDetailResponseSchema.parse(await globalDetail.json()).event.scannerAccess).toBeUndefined();
    expect(
      (await listPermissionHolders(env.DB, { permission: "agenda:check", context, limit: 10 })).some(
        (holder) => holder.id === operatorId,
      ),
    ).toBe(false);
    expect((await findUserPermissionRecipients(env.DB, "agenda:check")).some((row) => row.id === operatorId)).toBe(
      false,
    );
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?")
      .bind(new Date().toISOString(), globalOrganizerId)
      .run();
    // Reviewers, live-room and studio roles do not work the check-in desk.
    for (const roleId of [
      EVENT_TEAM_ROLE_IDS.program_committee,
      EVENT_TEAM_ROLE_IDS.moderator,
      EVENT_TEAM_ROLE_IDS.studio_operator,
    ]) {
      const assignmentId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,created_at)
         VALUES(?,?,?,'event',?,?)`,
      )
        .bind(assignmentId, operatorId, roleId, eventId, new Date().toISOString())
        .run();
      const actor = {
        identityType: "user",
        id: operatorId,
        grants: await computeGrantsForUser(env.DB, operatorId),
      } as AuthAdmin;
      expect(hasPermission(actor, "agenda:check", context)).toBe(false);
      expect((await scan(scanBody({ action: "check" }))).status).toBe(403);
      await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?")
        .bind(new Date().toISOString(), assignmentId)
        .run();
    }
    for (const roleId of [EVENT_TEAM_ROLE_IDS.organizer, EVENT_TEAM_ROLE_IDS.volunteer]) {
      const assignmentId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO user_roles(id,user_id,role_id,context_type,context_id,created_at)
         VALUES(?,?,?,'event',?,?)`,
      )
        .bind(assignmentId, operatorId, roleId, eventId, new Date().toISOString())
        .run();

      const grants = await computeGrantsForUser(env.DB, operatorId);
      const actor = { identityType: "user", id: operatorId, grants } as AuthAdmin;
      for (const permission of ["agenda:check", "agenda:admit", "agenda:attendance_record"] as const) {
        expect(hasPermission(actor, permission, context)).toBe(true);
        expect(hasPermission(actor, permission, { type: "event", id: crypto.randomUUID() })).toBe(false);
      }
      expect(hasPermission(actor, "agenda:admit_exceptions", context)).toBe(false);
      expect(
        (await listPermissionHolders(env.DB, { permission: "agenda:check", context, limit: 10 })).some(
          (holder) => holder.id === operatorId,
        ),
      ).toBe(true);
      for (const action of ["check", "admission", "attendance"] as const)
        expect((await scan(scanBody({ action }))).status).toBe(200);
      expect((await callApi(env, manifestUrl, { headers })).status).toBe(200);
      const detail = await callApi(env, "/api/v1/events/scan-test", { headers });
      expect(detail.status).toBe(200);
      expect(eventDetailResponseSchema.parse(await detail.json()).event.scannerAccess?.canScan).toBe(true);

      await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE id=?")
        .bind(new Date().toISOString(), assignmentId)
        .run();
    }
    await env.DB.prepare("UPDATE user_roles SET revoked_at=NULL WHERE id=?").bind(globalOrganizerId).run();
    expect((await scan(scanBody({ action: "check" }))).status).toBe(403);
    expect((await callApi(env, manifestUrl, { headers })).status).toBe(403);
  });
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
    await env.DB.prepare(
      "DELETE FROM registration_day_attendance WHERE registration_id IN (SELECT id FROM registrations WHERE event_id=?)",
    )
      .bind(eventId)
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
    expect((await scan(scanBody({ action: "check" }))).status).toBe(403);
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
