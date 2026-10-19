import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { badgeCredentialSchema, formatBadgeCredential } from "../assets/shared/schemas/badge-credential";
import {
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
} from "../assets/shared/schemas/route-contracts-event-badges";
import { eventScanRequestSchema, eventScanResponseSchema } from "../assets/shared/schemas/event-participation-scanning";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/badge-hash";
import { offlineEligibility } from "../functions/_lib/services/event-participation/offline-eligibility";

const fixture = createEventScannerFixture();
async function evidence() {
  return Promise.all(
    [
      "event_badge_credentials",
      "audit_log",
      "registrations",
      "agenda_session_participations",
      "event_attendance_observations",
      "event_scan_attempts",
      "event_scanner_upload_receipts",
    ].map(async (table) => (await env.DB.prepare("SELECT * FROM " + table + " ORDER BY rowid").all()).results),
  );
}
async function originalId() {
  const row = await env.DB.prepare("SELECT id FROM event_badge_credentials WHERE credential_hash=?")
    .bind(await hashBadgeCredential(fixture.badgeId))
    .first<{ id: string }>();
  if (!row) throw new Error("Missing fixture credential");
  return row.id;
}
async function issue(db: DatabaseLike, replaceBadgeId: string) {
  const body = badgeIssueRequestSchema.parse({
    operationId: crypto.randomUUID(),
    userId: fixture.userId,
    replaceBadgeId,
  });
  return callApi({ ...env, DB: db }, "/api/v1/events/scan-test/badges", {
    method: "POST",
    headers: {
      authorization: "Bearer " + fixture.token,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
/** Injects an actual existing UNIQUE value in only the selected native INSERT; the real batch rolls back. */
function collide(hash: string, failures: number) {
  let insertions = 0;
  const originals = new WeakMap<StatementLike, StatementLike>();
  const db: DatabaseLike = {
    prepare(sql) {
      const statement = env.DB.prepare(sql);
      if (!sql.startsWith("INSERT INTO event_badge_credentials")) return statement;
      const wrapped: StatementLike = {
        bind(...values) {
          insertions++;
          if (insertions <= failures) values[3] = hash;
          return statement.bind(...values);
        },
        run<T = Record<string, unknown>>() {
          return statement.run<T>();
        },
        all<T = Record<string, unknown>>() {
          return statement.all<T>();
        },
        first<T = Record<string, unknown>>(column?: string) {
          return statement.first<T>(column);
        },
      };
      originals.set(wrapped, statement);
      return wrapped;
    },
    batch: (statements) => env.DB.batch(statements.map((statement) => originals.get(statement) ?? statement)),
  };
  return { db, insertions: () => insertions };
}
describe("Short badge credentials through mounted issuance and scanning", () => {
  beforeEach(() => fixture.setup());
  it("normalizes display/case before receipt hashing and replays the original operation once", async () => {
    expect(fixture.badgeId).toHaveLength(16);
    const original = fixture.scanBody({
      action: "attendance",
      occurrenceId: null,
      capturePublicationRevision: 0,
    });
    const response = await fixture.scan({
      ...original,
      badgeId: formatBadgeCredential(fixture.badgeId).toLowerCase(),
    });
    expect(response.status).toBe(200);
    const receipt = eventScanResponseSchema.parse(await response.json());
    expect(receipt).toMatchObject({ recorded: true, attendanceRecorded: true });
    const after = await evidence();
    const replay = await fixture.scan({
      ...original,
      badgeId: " " + formatBadgeCredential(fixture.badgeId).replace(/-/g, " ") + " ",
    });
    expect(replay.status).toBe(200);
    expect(eventScanResponseSchema.parse(await replay.json())).toEqual(receipt);
    expect(await evidence()).toEqual(after);
    const row = await env.DB.prepare("SELECT request_hash FROM event_scanner_upload_receipts WHERE operation_id=?")
      .bind(original.operationId)
      .first<{ request_hash: string }>();
    expect(row?.request_hash).toBe(await hashBadgeCredential(JSON.stringify(eventScanRequestSchema.parse(original))));
    const manifest = await offlineEligibility(env.DB, fixture.eventId, fixture.operatorId, {});
    const badgeId = await originalId();
    expect(manifest.entries.find((entry) => entry.badgeId === badgeId)?.credentialHash).toBe(
      await hashBadgeCredential(badgeCredentialSchema.parse(formatBadgeCredential(fixture.badgeId))),
    );
  });
  it("rejects malformed manual input before any receipt, observation, or audit is written", async () => {
    const before = await evidence();
    const response = await fixture.scan(fixture.scanBody({ badgeId: "ABCD-EFGH JKLM-NPQR", occurrenceId: null }));
    expect(response.status).toBe(400);
    expect(await evidence()).toEqual(before);
  });
  it.each(["record", "00000000-0000-4000-8000-000000000077", "abcdefabcdefabcdefabcdefabcdefab"])(
    "refuses unsupported credential input %s before any database effect",
    async (input) => {
      const before = await evidence();
      const badgeId = input === "record" ? await originalId() : input;
      const response = await fixture.scan(fixture.scanBody({ badgeId, occurrenceId: null }));
      expect(response.status).toBe(400);
      expect(await evidence()).toEqual(before);
    },
  );
  it("retries one exact hash collision with atomic replacement and one committed audit", async () => {
    const id = await originalId(),
      hash = await hashBadgeCredential(fixture.badgeId);
    const retry = collide(hash, 1);
    const response = await issue(retry.db, id);
    expect(response.status, await response.clone().text()).toBe(200);
    const result = badgeIssueResponseSchema.parse(await response.json());
    if (result.result !== "issued") throw new Error("Expected issued credential");
    expect(retry.insertions()).toBe(2);
    expect(await hashBadgeCredential(result.credential)).not.toBe(hash);
    const badges = (await env.DB.prepare("SELECT id,revoked_at FROM event_badge_credentials").all()).results;
    expect(badges).toHaveLength(2);
    expect(badges.find((badge) => badge.id === id)?.revoked_at).not.toBeNull();
    expect((await env.DB.prepare("SELECT id FROM audit_log WHERE action='badge_replaced'").all()).results).toHaveLength(
      1,
    );
    expect((await env.DB.prepare("SELECT id FROM audit_log WHERE action='badge_issued'").all()).results).toHaveLength(
      2,
    );
  });
  it("exhausts only three hash-collision attempts without revoking or writing any dependent effect", async () => {
    const id = await originalId(),
      before = await evidence();
    const collision = collide(await hashBadgeCredential(fixture.badgeId), 3);
    const response = await issue(collision.db, id);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "BADGE_ISSUANCE_RETRY" },
    });
    expect(collision.insertions()).toBe(3);
    expect(await evidence()).toEqual(before);
  });
});
