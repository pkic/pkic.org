import { generateBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import { recordScan } from "../functions/_lib/services/event-participation/scanning";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";

const fixture = createEventScannerFixture();
describe("Immutable scan calendar context", () => {
  beforeEach(fixture.setup);
  it.each(["check", "attendance", "checkout"] as const)(
    "records a recognized %s refusal for an unavailable target without creating presence",
    async (action) => {
      const body = eventScanRequestSchema.parse(fixture.scanBody({ action, occurrenceId: crypto.randomUUID() }));
      expect(await (await fixture.scan(body)).json()).toMatchObject({
        outcome: "warning",
        reason: "verification_required",
        recorded: true,
        attendanceRecorded: false,
        checkoutRecorded: false,
        admissionRecorded: false,
      });
      expect(await (await fixture.scan(body)).json()).toMatchObject({ recorded: true, outcome: "warning" });
      expect(
        await env.DB.prepare("SELECT occurrence_id,capture_time_zone FROM event_scan_attempts WHERE operation_id=?")
          .bind(body.operationId)
          .first(),
      ).toEqual({ occurrence_id: null, capture_time_zone: "UTC" });
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first()).toEqual({ total: 1 });
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
        total: 0,
      });
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions").first()).toEqual({
        total: 0,
      });
      expect(
        await (
          await fixture.scan(
            fixture.scanBody({ action, occurrenceId: body.occurrenceId, badgeId: generateBadgeCredential() }),
          )
        ).json(),
      ).toMatchObject({ outcome: "unknown", recorded: false });
      expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_scan_attempts").first()).toEqual({ total: 1 });
    },
  );
  it("records invalid-location failure against a recognized badge and its event session", async () => {
    const body = eventScanRequestSchema.parse(fixture.scanBody({ action: "attendance", roomId: crypto.randomUUID() }));
    expect(await (await fixture.scan(body)).json()).toMatchObject({
      outcome: "warning",
      reason: "wrong_location",
      recorded: true,
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    expect(
      await env.DB.prepare("SELECT occurrence_id,room_id FROM event_scan_attempts WHERE operation_id=?")
        .bind(body.operationId)
        .first(),
    ).toEqual({ occurrence_id: fixture.occurrenceId, room_id: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_session_admissions").first()).toEqual({
      total: 0,
    });
  });
  it.each(["check", "admission", "attendance", "checkout"] as const)(
    "captures %s context independently of subsequent timezone changes",
    async (action) => {
      const body = eventScanRequestSchema.parse(
        fixture.scanBody({
          action,
          occurrenceId: null,
          observedAt: "2026-10-03T00:30:00.000Z",
          capturePublicationRevision: 0,
        }),
      );
      expect(await (await fixture.scan(body)).json()).toMatchObject({ recorded: true, outcome: "eligible" });
      const original = await env.DB.prepare(
        "SELECT capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
      )
        .bind(body.operationId)
        .first();
      expect(original).toEqual({
        capture_day_date: "2026-10-03",
        capture_time_zone: "UTC",
        capture_publication_revision: 0,
        capture_context_source: "published_manifest",
      });
      await env.DB.prepare("UPDATE events SET timezone='America/Los_Angeles' WHERE id=?").bind(fixture.eventId).run();
      await env.DB.prepare("UPDATE event_agenda_state SET published_revision=NULL WHERE event_id=?")
        .bind(fixture.eventId)
        .run();
      expect(await (await fixture.scan(body)).json()).toMatchObject({ recorded: true, outcome: "eligible" });
      expect(
        await env.DB.prepare(
          "SELECT capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_scan_attempts WHERE operation_id=?",
        )
          .bind(body.operationId)
          .first(),
      ).toEqual(original);
      if (action === "attendance" || action === "checkout")
        expect(
          await env.DB.prepare(
            "SELECT capture_day_date,capture_time_zone,capture_publication_revision,capture_context_source FROM event_attendance_observations WHERE attempt_id=(SELECT id FROM event_scan_attempts WHERE operation_id=?)",
          )
            .bind(body.operationId)
            .first(),
        ).toEqual(original);
      expect((await fixture.scan({ ...body, capturePublicationRevision: null })).status).toBe(409);
    },
  );
  it("retains a recognized attempt when the historical publication is unavailable", async () => {
    const body = eventScanRequestSchema.parse(
      fixture.scanBody({ action: "attendance", occurrenceId: null, capturePublicationRevision: 999 }),
    );
    expect(await (await fixture.scan(body)).json()).toMatchObject({
      outcome: "unverified",
      reason: "verification_required",
      recorded: true,
      attendanceRecorded: true,
      admissionRecorded: false,
    });
    expect(
      await env.DB.prepare("SELECT capture_day_date,capture_time_zone FROM event_scan_attempts WHERE operation_id=?")
        .bind(body.operationId)
        .first(),
    ).toEqual({ capture_day_date: null, capture_time_zone: null });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions").first()).toEqual({ total: 0 });
  });
  it("preserves a recognized unverified attempt without allocating admission on a context race", async () => {
    const db = mutateBeforeNextBatch(env.DB, () =>
      env.DB.prepare("UPDATE events SET timezone='Europe/Amsterdam' WHERE id=?").bind(fixture.eventId).run(),
    );
    const body = eventScanRequestSchema.parse(fixture.scanBody({ action: "attendance", occurrenceId: null }));
    expect(
      await recordScan(
        db,
        fixture.eventId,
        { operatorUserId: fixture.operatorId, canScan: true, canAdmitExceptions: false },
        body,
      ),
    ).toMatchObject({ outcome: "unverified", recorded: true, attendanceRecorded: true, admissionRecorded: false });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_entry_admissions").first()).toEqual({ total: 0 });
    expect(await env.DB.prepare("SELECT COUNT(*) AS total FROM event_attendance_observations").first()).toEqual({
      total: 1,
    });
    expect(
      await env.DB.prepare("SELECT capture_time_zone FROM event_scan_attempts WHERE operation_id=?")
        .bind(body.operationId)
        .first(),
    ).toEqual({ capture_time_zone: "UTC" });
  });
});
