import { beforeEach, describe, expect, it } from "vitest";
import { administratorGrants } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { createUserBackedAuthAdmin } from "../functions/_lib/auth/admin-identity";
import { exportAttendance } from "../functions/_lib/services/event-participation/attendance-export";
import { eventAttendancePeople } from "../functions/_lib/services/event-participation/attendance-people-report";
import { eventAttendanceAttempts } from "../functions/_lib/services/event-participation/attendance-attempt-report";
const fixture = createEventScannerFixture();
const { eventId, userId, operatorId } = fixture;
function download(kind: string, query = "", authenticated = true) {
  return callApi(env, `/api/v1/events/scan-test/attendance/${kind}/exports${query}`, {
    headers: authenticated ? { authorization: `Bearer ${fixture.token}` } : {},
  });
}
async function observation(action = "attendance", overrides: Record<string, unknown> = {}) {
  const response = await fixture.scan(fixture.scanBody({ action, occurrenceId: null, ...overrides }));
  expect(response.status).toBe(200);
}
async function actor() {
  const session = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?")
    .bind(operatorId)
    .first<{ id: string }>();
  return createUserBackedAuthAdmin({
    id: operatorId,
    email: "operator@example.test",
    grants: administratorGrants,
    sessionId: session!.id,
  });
}
describe("Complete scoped attendance CSV exports", () => {
  beforeEach(fixture.setup);
  it("exports the same filtered people population with formula-safe identities and labeled uncertainty", async () => {
    await env.DB.prepare("UPDATE users SET first_name=?,last_name=? WHERE id=?")
      .bind("=SUM(A1:A2)", 'Quoted, "Name"', userId)
      .run();
    await observation();
    await observation("checkout");
    const report = await eventAttendancePeople(env.DB, eventId, { dayDate: "2026-10-03" });
    expect(report.page.total).toBe(1);
    const response = await download("people", "?dayDate=2026-10-03");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("cache-control")).toContain("no-store");
    const csv = await response.text();
    expect(csv).toContain('"\'=SUM(A1:A2) Quoted, ""Name"""');
    expect(csv).toContain("reservedSessions,savedSessions,approvalPendingSessions");
    expect(csv).toContain("pending,not_established,unverified,not_established");
    expect(csv).toContain("scannerCoverage,scannerKnownEpochs,scannerOpenEpochs");
    expect(csv).toContain("from_event_creation");
    expect(csv.split("\r\n")).toHaveLength(2);
    expect((await download("people", "?attendanceMode=virtual")).status).toBe(200);
    expect((await (await download("people", "?attendanceMode=virtual")).text()).split("\r\n")).toHaveLength(1);
  });
  it("exports denied and checkout attempts without inventing presence, with safe metadata-only audit", async () => {
    await observation("checkout");
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
      .bind(new Date().toISOString(), eventId)
      .run();
    await observation("check");
    const report = await eventAttendanceAttempts(env.DB, eventId, { action: "check" });
    expect(report.page.total).toBe(1);
    const csv = await (await download("attempts", "?action=check&reason=revoked_badge")).text();
    expect(csv).toContain("check,denied,revoked_badge");
    expect(csv).toContain(
      "captureState,captureDayDate,captureTimeZone,capturePublicationRevision,captureContextSource,missingContextReason",
    );
    expect(csv).toContain("captured_calendar_date");
    expect(report.attempts[0].captureContext.state).toBe("captured");
    expect(csv).not.toContain(",checkout,");
    expect((await (await download("people")).text()).split("\r\n")).toHaveLength(1);
    const audit = await env.DB.prepare(
      "SELECT details_json FROM audit_log WHERE action='agenda.attendance.exported'",
    ).all<{ details_json: string }>();
    expect(audit.results).toHaveLength(2);
    expect(JSON.stringify(audit.results)).not.toContain(userId);
    expect(JSON.stringify(audit.results)).not.toContain("example.test");
    expect(JSON.stringify(audit.results)).not.toContain("revoked_badge");
  });
  it("refuses unauthorized and invalid exports without silently truncating or widening scope", async () => {
    expect((await download("people", "", false)).status).toBe(401);
    expect((await download("attempts", "?offset=200")).status).toBe(400);
    expect((await download("people", `?occurrenceId=${crypto.randomUUID()}`)).status).toBe(404);
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'agenda:check','event',?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, eventId, new Date().toISOString())
      .run();
    expect((await download("people")).status).toBe(403);
    expect((await download("summary")).status).toBe(403);
  });

  async function grant(permission: string, contextType = "event", contextId = eventId) {
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,?,?,?,?)",
    )
      .bind(crypto.randomUUID(), operatorId, permission, contextType, contextId, new Date().toISOString())
      .run();
  }
  it("allows a normal attendance-read-only operator to export all three exact event collections", async () => {
    await observation();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), operatorId)
      .run();
    await grant("agenda:attendance_read");
    for (const kind of ["people", "attempts", "summary"]) expect((await download(kind)).status).toBe(200);
    expect((await fixture.scan(fixture.scanBody({ action: "checkout" }))).status).toBe(403);
  });
  it("rejects a foreign event attendance grant and a real sponsor lead export grant", async () => {
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), operatorId)
      .run();
    const foreignEvent = crypto.randomUUID();
    const sponsorId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES(?,?,'Foreign event','UTC',?,?)",
    )
      .bind(foreignEvent, `foreign-${foreignEvent}`, now, now)
      .run();
    await grant("agenda:attendance_read", "event", foreignEvent);
    for (const kind of ["people", "attempts", "summary"]) expect((await download(kind)).status).toBe(403);
    await env.DB.prepare(
      "INSERT INTO sponsorships(id,sponsor_type,event_id,non_member_name,pipeline_stage,created_at,updated_at) VALUES(?,'event',?,'Synthetic sponsor','active',?,?)",
    )
      .bind(sponsorId, eventId, now, now)
      .run();
    await grant("agenda:leads_export", "event_sponsor", sponsorId);
    for (const kind of ["people", "attempts", "summary"]) expect((await download(kind)).status).toBe(403);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.attendance.exported'").first(),
    ).toEqual({ total: 0 });
  });
  it("refuses mounted exports after the current user session expires", async () => {
    await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?")
      .bind(operatorId)
      .run();
    for (const kind of ["people", "attempts", "summary"]) expect((await download(kind)).status).toBe(401);
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.attendance.exported'").first(),
    ).toEqual({ total: 0 });
  });
  it("enforces exact row and byte caps with no partial export audit", async () => {
    await observation("checkout");
    await observation("checkout");
    const authenticated = await actor();
    const limits = { people: 2, attempts: 2, maxBytes: 100000 };
    expect((await exportAttendance(env.DB, eventId, authenticated, "attempts", {}, limits)).rowCount).toBe(2);
    await observation("checkout");
    await expect(exportAttendance(env.DB, eventId, authenticated, "attempts", {}, limits)).rejects.toMatchObject({
      status: 413,
      code: "ATTENDANCE_EXPORT_ROW_LIMIT",
    });
    await expect(
      exportAttendance(env.DB, eventId, authenticated, "summary", {}, { ...limits, maxBytes: 10 }),
    ).rejects.toMatchObject({ status: 413, code: "CSV_EXPORT_TOO_LARGE" });
    expect(
      await env.DB.prepare("SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.attendance.exported'").first(),
    ).toEqual({ total: 1 });
  });
  it.each(["permission", "session"])(
    "rechecks %s at final disclosure/audit boundary and returns no CSV after revocation",
    async (kind) => {
      await observation("checkout");
      const authenticated = await actor();
      const db = mutateBeforeNextBatch(env.DB, () =>
        kind === "session"
          ? env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
              .bind(new Date().toISOString(), operatorId)
              .run()
          : env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(operatorId).run(),
      );
      await expect(exportAttendance(db, eventId, authenticated, "attempts", {})).rejects.toMatchObject({
        status: 403,
        code: "ATTENDANCE_EXPORT_PERMISSION_CHANGED",
      });
      expect(
        await env.DB.prepare(
          "SELECT COUNT(*) AS total FROM audit_log WHERE action='agenda.attendance.exported'",
        ).first(),
      ).toEqual({ total: 0 });
    },
  );
  it("blocks expired identifying exports before cleanup but permits honest aggregate export and retains account email", async () => {
    await observation();
    await env.DB.prepare("INSERT INTO retention_policies(event_id,user_retention_days,updated_at) VALUES(?,1,?)")
      .bind(eventId, new Date().toISOString())
      .run();
    await env.DB.prepare("UPDATE events SET ends_at='2000-01-01T00:00:00.000Z' WHERE id=?").bind(eventId).run();
    expect((await download("people")).status).toBe(410);
    expect((await download("attempts")).status).toBe(410);
    const summary = await download("summary");
    expect(summary.status).toBe(200);
    expect(await summary.text()).toContain("closed");
    expect(
      (await env.DB.prepare("SELECT email FROM users WHERE id=?").bind(userId).first<{ email: string }>())!.email,
    ).toContain("example.test");
  });
});
