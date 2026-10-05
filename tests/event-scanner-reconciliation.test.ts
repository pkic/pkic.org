import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { eventScannerReconciliation } from "../functions/_lib/services/event-participation/scanner-reconciliation";
import { closeScannerDeviceSession } from "../functions/_lib/services/event-participation/scanner-device-sessions";
import { eventAttendanceSummary } from "../functions/_lib/services/event-participation/attendance-summary";
import { recordScan } from "../functions/_lib/services/event-participation/scanning";
import { eventScanRequestSchema } from "../assets/shared/schemas/event-participation-scanning";
import { seedLegacyOfflineGrant } from "./helpers/legacy-offline-grant";
import type { ScannerReconciliation } from "../assets/shared/schemas/event-scanner-reconciliation";

const fixture = createEventScannerFixture();
const closing = (highWaterSequence: number) => ({
  operationId: crypto.randomUUID(),
  highWaterSequence,
  pendingCount: 0 as const,
  recoveryCount: 0 as const,
});
async function preserveProof(proof: ScannerReconciliation) {
  const reviewId = crypto.randomUUID(),
    runId = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO event_evidence_retention_reviews(id,event_id,actor_user_id,operation_id,review_hash,policy_revision,source_generation,publication_revision,time_zone,counts_json,reconciliation_json,reviewed_at,expires_at) VALUES(?,?,?,?,'${"a".repeat(64)}',1,0,0,'UTC','{}',?,?,?)`,
  )
    .bind(
      reviewId,
      fixture.eventId,
      fixture.operatorId,
      crypto.randomUUID(),
      JSON.stringify(proof),
      now,
      new Date(Date.now() + 60_000).toISOString(),
    )
    .run();
  await env.DB.prepare(
    "INSERT INTO event_evidence_retention_runs(id,event_id,review_id,actor_user_id,operation_id,policy_revision,expected_generation,publication_revision,time_zone,status,phase,ordinal,started_at,reconciliation_json) VALUES(?,?,?,?,?,1,0,0,'UTC','running','aggregates',0,?,?)",
  )
    .bind(runId, fixture.eventId, reviewId, fixture.operatorId, crypto.randomUUID(), now, JSON.stringify(proof))
    .run();
  return { runId, now };
}
describe("Event-wide scanner transport reconciliation coverage", () => {
  beforeEach(fixture.setup);
  it("records coverage only from new event creation and counts empty enrolled open devices", async () => {
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      scope: "event",
      coverage: "from_event_creation",
      sourceState: "live",
      coverageStartedAt: expect.any(String),
      knownEpochs: 1,
      openEpochs: 1,
      unknownHighWaterEpochs: 1,
      unclosedGrants: 0,
      deviceBacklog: "pending",
    });
    await env.DB.prepare("DELETE FROM event_scanner_reconciliation_coverage WHERE event_id=?")
      .bind(fixture.eventId)
      .run();
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(0));
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      coverage: "legacy_unknown",
      coverageStartedAt: null,
      closedEpochs: 1,
      unclosedGrants: 0,
      deviceBacklog: "unknown",
    });
  });
  it("proves only transport closure and retains attendance completeness as not established", async () => {
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(0));
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      closedEpochs: 1,
      openEpochs: 0,
      closingEpochs: 0,
      unknownHighWaterEpochs: 0,
      missingDeclaredReceipts: 0,
      deviceBacklog: "complete",
    });
    expect((await eventAttendanceSummary(env.DB, fixture.eventId, {})).sync).toMatchObject({
      deviceBacklog: "complete",
      completeness: "not_established",
      scannerReconciliation: { scope: "event", deviceBacklog: "complete" },
    });
  });
  it("counts missing declared receipts across the event even when an attendance report filters a session", async () => {
    const body = fixture.scanBody({
      badgeId: crypto.randomUUID(),
      scannerSession: { epochId: fixture.epochId, sequence: 2 },
    });
    expect((await fixture.scan(body)).status).toBe(200);
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(3));
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      knownEpochs: 1,
      openEpochs: 0,
      closingEpochs: 1,
      closedEpochs: 0,
      unknownHighWaterEpochs: 0,
      missingDeclaredReceipts: 2,
      untrackedAttempts: 0,
      deviceBacklog: "pending",
    });
    expect(
      (await eventAttendanceSummary(env.DB, fixture.eventId, { occurrenceId: fixture.occurrenceId })).sync
        .scannerReconciliation.missingDeclaredReceipts,
    ).toBe(2);
  });
  it("keeps untracked successful or unsuccessful historical attempts unknown despite a closed epoch", async () => {
    await recordScan(
      env.DB,
      fixture.eventId,
      { operatorUserId: fixture.operatorId, canScan: true, canAdmitExceptions: true },
      eventScanRequestSchema.parse(fixture.scanBody({ action: "check" })),
    );
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(0));
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      closedEpochs: 1,
      untrackedAttempts: 1,
      deviceBacklog: "unknown",
    });
  });
  it("keeps outstanding grants pending when all scanner epochs have closed", async () => {
    await seedLegacyOfflineGrant({
      eventId: fixture.eventId,
      occurrenceId: fixture.occurrenceId,
      operatorId: fixture.operatorId,
      deviceId: fixture.deviceId,
    });
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(0));
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      closedEpochs: 1,
      unclosedGrants: 1,
      deviceBacklog: "pending",
    });
  });
  it("never converts disappearing raw ledgers during retention into a new proof of completeness", async () => {
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(0));
    await env.DB.prepare("UPDATE event_evidence_retention_state SET active_run_id=? WHERE event_id=?")
      .bind(crypto.randomUUID(), fixture.eventId)
      .run();
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      sourceState: "retention_in_progress",
      deviceBacklog: "unknown",
    });
    await env.DB.prepare("UPDATE event_evidence_retention_state SET active_run_id=NULL,purged_at=? WHERE event_id=?")
      .bind(new Date().toISOString(), fixture.eventId)
      .run();
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      sourceState: "purged",
      deviceBacklog: "unknown",
    });
  });
  it("uses only the pinned active run's immutable reconciliation proof and marks its current source state", async () => {
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(0));
    const proof = await eventScannerReconciliation(env.DB, fixture.eventId);
    const { runId } = await preserveProof(proof);
    await env.DB.prepare("UPDATE event_evidence_retention_state SET active_run_id=? WHERE event_id=?")
      .bind(runId, fixture.eventId)
      .run();
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toEqual({
      ...proof,
      sourceState: "retention_in_progress",
    });
    await expect(
      env.DB.prepare("UPDATE event_evidence_retention_runs SET reconciliation_json='{}' WHERE id=?").bind(runId).run(),
    ).rejects.toThrow("EVIDENCE_RETENTION_RECONCILIATION_IMMUTABLE");
    await env.DB.prepare("UPDATE event_evidence_retention_state SET active_run_id=? WHERE event_id=?")
      .bind(crypto.randomUUID(), fixture.eventId)
      .run();
    expect((await eventScannerReconciliation(env.DB, fixture.eventId)).deviceBacklog).toBe("unknown");
  });
  it("selects completed proof only for the exact persisted purge completion and preserves unknown coverage", async () => {
    await env.DB.prepare("DELETE FROM event_scanner_reconciliation_coverage WHERE event_id=?")
      .bind(fixture.eventId)
      .run();
    await closeScannerDeviceSession(env.DB, fixture.eventId, fixture.operatorId, fixture.epochId, closing(0));
    const proof = await eventScannerReconciliation(env.DB, fixture.eventId);
    const { runId, now } = await preserveProof(proof);
    await env.DB.prepare(
      "UPDATE event_evidence_retention_runs SET status='complete',phase='complete',completed_at=? WHERE id=?",
    )
      .bind(now, runId)
      .run();
    await env.DB.prepare("UPDATE event_evidence_retention_state SET purged_at=? WHERE event_id=?")
      .bind(now, fixture.eventId)
      .run();
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toEqual({ ...proof, sourceState: "purged" });
    await env.DB.prepare("UPDATE event_evidence_retention_state SET purged_at=? WHERE event_id=?")
      .bind("2000-01-01T00:00:00.000Z", fixture.eventId)
      .run();
    expect(await eventScannerReconciliation(env.DB, fixture.eventId)).toMatchObject({
      sourceState: "purged",
      deviceBacklog: "unknown",
    });
  });
});
