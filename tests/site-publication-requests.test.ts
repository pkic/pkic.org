import { profileD1Flow } from "./helpers/d1-flow-profile";
import { ADMINISTRATOR_FIXTURE_USER_SQL, administratorGrants } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import { beforeEach, describe, it, expect } from "vitest";
import { resetDb } from "./helpers/reset-db";
import { seedEventAndAdmin, queryAll } from "./helpers/context";
import { prepareAuthorizationGuard } from "../functions/_lib/db/authorization-guard";
import {
  prepareSitePublicationRequest,
  prepareSitePublicationRequestSelection,
  listSitePublicationRequests,
  getSitePublicationDelivery,
  recordSitePublicationBuild,
  recordSitePublicationActivation,
} from "../functions/_lib/services/site-publication-requests";
import { insertUser } from "./helpers/membership";
import {
  sitePublicationRequestSchema,
  sitePublicationRequestQuerySchema,
} from "../assets/shared/schemas/site-publication-requests";
import type { AuthAdmin } from "../functions/_lib/types";
const snapshotId = "a".repeat(64);
async function fixture() {
  const { eventId } = await seedEventAndAdmin(env.DB);
  const [user] = await queryAll<{ id: string }>(env.DB, ADMINISTRATOR_FIXTURE_USER_SQL);
  const actor: AuthAdmin = {
    identityType: "user",
    id: user!.id,
    email: "synthetic@example.test",
    grants: administratorGrants,
  };
  return { eventId, actor };
}
async function request(eventId: string, revision: number) {
  await env.DB.batch([
    prepareSitePublicationRequest(env.DB, {
      resourceType: "event_agenda",
      resourceId: eventId,
      revision,
      reasonCode: "agenda_approved",
      deduplicationKey: `agenda:${eventId}:${revision}`,
    }),
  ]);
  const [row] = await queryAll<{ id: string; sequence: number }>(
    env.DB,
    "SELECT id,sequence FROM site_publication_requests WHERE resource_id=? AND revision=?",
    eventId,
    revision,
  );
  return row!;
}
async function complete(actor: AuthAdmin, row: { id: string; sequence: number }, buildId: string) {
  const leaseToken = crypto.randomUUID();
  await env.DB.prepare(
    "UPDATE site_publication_requests SET status='rendering',lease_token=?,lease_owner='synthetic-worker',lease_expires_at=? WHERE id=?",
  )
    .bind(leaseToken, new Date(Date.now() + 60_000).toISOString(), row.id)
    .run();
  await recordSitePublicationBuild(env.DB, actor, {
    requestId: row.id,
    leaseToken,
    sourceSequence: row.sequence,
    snapshotId,
    buildId,
    releaseId: `release-${buildId}`,
  });
}
beforeEach(resetDb);
describe("canonical site publication request ledger", () => {
  it("queues distinct selected profiles with canonical identifiers and deduplicates replay", async () => {
    const first = await insertUser(env.DB, "bulk-one@example.test");
    const second = await insertUser(env.DB, "bulk-two@example.test");
    const statement = () =>
      prepareSitePublicationRequestSelection(
        env.DB,
        {
          resourceType: "user_profile",
          revision: 1,
          reasonCode: "user_profile_changed",
          deduplicationKey: "synthetic-bulk",
        },
        {
          sql: "SELECT id AS resource_id FROM users WHERE id IN (?,?) UNION ALL SELECT ? AS resource_id",
          bindings: [first, second, first],
        },
      );
    await env.DB.batch([statement()]);
    const read = () =>
      queryAll<{ id: string; resource_id: string; deduplication_key: string }>(
        env.DB,
        "SELECT id,resource_id,deduplication_key FROM site_publication_requests ORDER BY resource_id",
      );
    const rows = await read();
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.resource_id).sort()).toEqual([first, second].sort());
    for (const row of rows) {
      sitePublicationRequestSchema
        .pick({ id: true, resourceId: true, deduplicationKey: true })
        .parse({ id: row.id, resourceId: row.resource_id, deduplicationKey: row.deduplication_key });
      expect(row.deduplication_key).toBe(`synthetic-bulk:${row.resource_id}`);
    }
    await env.DB.batch([statement()]);
    expect(await read()).toEqual(rows);
  });

  it("atomically queues monotonic deduplicated identities and rolls back with the caller mutation", async () => {
    const { eventId } = await fixture();
    const first = await request(eventId, 1);
    const replay = await request(eventId, 1);
    expect(replay).toEqual(first);
    await expect(
      env.DB.prepare("UPDATE site_publication_requests SET revision=99 WHERE id=?").bind(first.id).run(),
    ).rejects.toThrow("SITE_PUBLICATION_REQUEST_IDENTITY_IMMUTABLE");
    expect((await getSitePublicationDelivery(env.DB)).desiredSequence).toBe(first.sequence);
    await expect(
      env.DB.batch([
        env.DB.prepare("UPDATE events SET name='Must roll back' WHERE id=?").bind(eventId),
        prepareSitePublicationRequest(env.DB, {
          resourceType: "event_agenda",
          resourceId: eventId,
          revision: 2,
          reasonCode: "agenda_approved",
          deduplicationKey: `agenda:${eventId}:1`,
        }),
      ]),
    ).rejects.toThrow("SITE_PUBLICATION_REQUEST_KEY_CONFLICT");
    expect((await queryAll<{ name: string }>(env.DB, "SELECT name FROM events WHERE id=?", eventId))[0]!.name).not.toBe(
      "Must roll back",
    );
    await expect(
      env.DB.batch([
        prepareSitePublicationRequest(env.DB, {
          resourceType: "event_agenda",
          resourceId: eventId,
          revision: 3,
          reasonCode: "rights_withdrawn",
          deduplicationKey: `withdrawal:${eventId}:3`,
        }),
        prepareAuthorizationGuard(env.DB, { sql: "SELECT 1 WHERE 0", bindings: [] }),
      ]),
    ).rejects.toThrow();
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_requests WHERE revision=3")).toEqual([]);
    const second = await request(eventId, 2);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(second.id).not.toBe(first.id);
  });
  it("does not claim delivery on build completion and requires matching explicit activation", async () => {
    const { eventId, actor } = await fixture();
    const row = await request(eventId, 1);
    await complete(actor, row, "build-one");
    expect((await getSitePublicationDelivery(env.DB)).deliveredSequence).toBe(0);
    const receipt = {
      requestId: row.id,
      sourceSequence: row.sequence,
      expectedDeliveredSequence: 0,
      snapshotId,
      buildId: "build-one",
      releaseId: "release-build-one",
      activationReceiptId: "activation-one",
      activatedAt: new Date().toISOString(),
    };
    await expect(
      recordSitePublicationActivation(env.DB, actor, { ...receipt, buildId: "different-build" }),
    ).rejects.toMatchObject({ code: "PUBLICATION_ACTIVATION_CHANGED" });
    expect(await queryAll(env.DB, "SELECT id FROM site_publication_activation_receipts")).toEqual([]);
    const delivered = await recordSitePublicationActivation(env.DB, actor, receipt);
    expect(delivered.deliveredSequence).toBe(row.sequence);
    expect(await recordSitePublicationActivation(env.DB, actor, receipt)).toEqual(delivered);
  });
  it("rejects late activation reports and preserves newer actual delivery", async () => {
    const { eventId, actor } = await fixture();
    const old = await request(eventId, 1),
      newer = await request(eventId, 2);
    await complete(actor, old, "old-build");
    await complete(actor, newer, "new-build");
    const activatedAt = new Date().toISOString();
    await recordSitePublicationActivation(env.DB, actor, {
      requestId: newer.id,
      sourceSequence: newer.sequence,
      expectedDeliveredSequence: 0,
      snapshotId,
      buildId: "new-build",
      releaseId: "release-new-build",
      activationReceiptId: "new-activation",
      activatedAt,
    });
    await expect(
      recordSitePublicationActivation(env.DB, actor, {
        requestId: old.id,
        sourceSequence: old.sequence,
        expectedDeliveredSequence: newer.sequence,
        snapshotId,
        buildId: "old-build",
        releaseId: "release-old-build",
        activationReceiptId: "old-activation",
        activatedAt,
      }),
    ).rejects.toMatchObject({ code: "PUBLICATION_ACTIVATION_CHANGED" });
    expect((await getSitePublicationDelivery(env.DB)).buildId).toBe("new-build");
  });
  it("bounds resource lists and requires exact event permission", async () => {
    const { eventId, actor } = await fixture();
    await request(eventId, 1);
    await request(eventId, 2);
    const profile = profileD1Flow(env.DB);
    const page = await listSitePublicationRequests(
      profile.db,
      actor,
      { resourceType: "event_agenda", resourceId: eventId },
      sitePublicationRequestQuerySchema.parse({ limit: 1, sort: "-sequence" }),
    );
    expect(page.requests).toHaveLength(1);
    expect((await profile.report()).queries.some(({ sql }) => /INSERT INTO authorization_guards/.test(sql))).toBe(
      false,
    );
    expect(page.page).toMatchObject({ total: 2, hasMore: true });
    expect(JSON.stringify(page)).not.toContain("leaseToken");
    const wrong: AuthAdmin = {
      ...actor,
      grants: [{ permission: "agenda:read", contextType: "event", contextId: crypto.randomUUID() }],
    };
    await expect(
      listSitePublicationRequests(
        env.DB,
        wrong,
        { resourceType: "event_agenda", resourceId: eventId },
        sitePublicationRequestQuerySchema.parse({}),
      ),
    ).rejects.toMatchObject({ status: 403 });
  });
});
