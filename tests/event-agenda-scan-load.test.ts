import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { hashBadgeCredential, recordScan } from "../functions/_lib/services/event-participation/scanning";
import type { EventScanRequest } from "../assets/shared/schemas/event-participation-scanning";

/** Synthetic native-D1 service benchmark; device camera/network latency is excluded. */
describe("high-volume event scanner", () => {
  beforeEach(async () => {
    await resetDb();
  });
  it("records 2,000 distinct arrivals at 16/32 concurrency and deduplicates offline replay", async () => {
    const { eventId } = await seedEventAndAdmin(env.DB);
    const [operator] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM users WHERE email='admin@pkic.org'");
    const observedAt = new Date().toISOString();
    const attendees = await Promise.all(
      Array.from({ length: 2000 }, async () => {
        const userId = crypto.randomUUID();
        const credential = crypto.randomUUID();
        return {
          userId,
          credential,
          hash: await hashBadgeCredential(credential),
          badgeId: crypto.randomUUID(),
          registrationId: crypto.randomUUID(),
          operationId: crypto.randomUUID(),
        };
      }),
    );
    for (let offset = 0; offset < attendees.length; offset += 100) {
      const json = JSON.stringify(attendees.slice(offset, offset + 100));
      await env.DB.batch([
        env.DB.prepare(
          "INSERT INTO users(id,email,normalized_email,role,active,created_at,updated_at) SELECT json_extract(value,'$.userId'),json_extract(value,'$.userId')||'@example.test',json_extract(value,'$.userId')||'@example.test','user',1,?,? FROM json_each(?)",
        ).bind(observedAt, observedAt, json),
        env.DB.prepare(
          "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) SELECT json_extract(value,'$.registrationId'),?,json_extract(value,'$.userId'),'registered','in_person','synthetic',json_extract(value,'$.registrationId'),?,? FROM json_each(?)",
        ).bind(eventId, observedAt, observedAt, json),
        env.DB.prepare(
          "INSERT INTO event_badge_credentials(id,event_id,user_id,credential_hash,created_at) SELECT json_extract(value,'$.badgeId'),?,json_extract(value,'$.userId'),json_extract(value,'$.hash'),? FROM json_each(?)",
        ).bind(eventId, observedAt, json),
      ]);
    }
    const devices = Array.from({ length: 32 }, () => crypto.randomUUID());
    const scans: EventScanRequest[] = attendees.map((attendee, index) => ({
      operatorUserId: operator.id,
      operationId: attendee.operationId,
      deviceId: devices[index % devices.length],
      badgeId: attendee.credential,
      occurrenceId: null,
      action: "attendance",
      observedAt,
    }));
    const authority = { operatorUserId: operator.id, canScan: true, canAdmitExceptions: false };
    async function runBurst(items: EventScanRequest[], concurrency: number) {
      const latencies: number[] = [];
      let cursor = 0;
      const start = performance.now();
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (cursor < items.length) {
            const scan = items[cursor++];
            const began = performance.now();
            const result = await recordScan(env.DB, eventId, authority, scan);
            latencies.push(performance.now() - began);
            expect(result.outcome).toBe("eligible");
          }
        }),
      );
      latencies.sort((a, b) => a - b);
      const percentile = (p: number) =>
        Number(latencies[Math.min(latencies.length - 1, Math.ceil(latencies.length * p) - 1)].toFixed(2));
      return {
        count: items.length,
        concurrency,
        elapsedMs: Number((performance.now() - start).toFixed(2)),
        p50Ms: percentile(0.5),
        p95Ms: percentile(0.95),
        p99Ms: percentile(0.99),
      };
    }
    const first = await runBurst(scans.slice(0, 1000), 16);
    const second = await runBurst(scans.slice(1000), 32);
    const replay = await runBurst(scans.slice(0, 256), 32);
    const [counts] = await queryAll<{ attempts: number; observations: number; people: number }>(
      env.DB,
      "SELECT (SELECT COUNT(*) FROM event_scan_attempts WHERE event_id=?) AS attempts,(SELECT COUNT(*) FROM event_attendance_observations WHERE event_id=?) AS observations,(SELECT COUNT(DISTINCT user_id) FROM event_attendance_observations WHERE event_id=?) AS people",
      eventId,
      eventId,
      eventId,
    );
    expect(counts).toEqual({ attempts: 2000, observations: 2000, people: 2000 });
    console.info(
      "[scanner-local-native-d1-benchmark]",
      JSON.stringify({ first, second, offlineReplay: replay, counts }),
    );
  }, 120000);
});
