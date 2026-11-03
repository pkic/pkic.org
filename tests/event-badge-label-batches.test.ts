import { beforeEach, describe, expect, it } from "vitest";
import { env } from "cloudflare:workers";
import { badgeLabelBatchResponseSchema } from "../assets/shared/schemas/event-badge-label-batches";
import { prepareBadgeLabelBatch } from "../functions/_lib/services/event-participation/badge-label-batches";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { mutateBeforeMatchingQuery } from "./helpers/database-races";
import { issueBadge } from "../functions/_lib/services/event-participation/badge-lifecycle";
import { profileD1Flow } from "./helpers/d1-flow-profile";

const fixture = createEventScannerFixture();
const endpoint = "/api/v1/events/scan-test/badges/labels/batches";
let registrationId: string;
const input = () => ({ operationId: crypto.randomUUID(), registrationIds: [registrationId] });
function request(body: unknown, token = fixture.token, db: DatabaseLike = env.DB) {
  return callApi({ ...env, DB: db as typeof env.DB }, endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}
describe("Compact authorized bulk label data", () => {
  beforeEach(async () => {
    await fixture.setup();
    await env.DB.prepare("UPDATE users SET first_name='Synthetic',last_name='Attendee' WHERE id=?")
      .bind(fixture.userId)
      .run();
    registrationId = (await env.DB.prepare("SELECT id FROM registrations WHERE event_id=? AND user_id=?")
      .bind(fixture.eventId, fixture.userId)
      .first<{ id: string }>())!.id;
  });
  it("recovers the existing QR and current profile with no SVG, PDF, artwork or replacement", async () => {
    await env.DB.prepare("UPDATE events SET settings_json=? WHERE id=?")
      .bind('{"badgeTemplate":{"invalid":true}}', fixture.eventId)
      .run();
    const body = input();
    const response = await request(body);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    const data = badgeLabelBatchResponseSchema.parse(await response.json());
    expect(data.labels[0]).toMatchObject({
      registrationId: registrationId,
      userId: fixture.userId,
      credential: fixture.badgeId,
      firstName: "Synthetic",
      lastName: "Attendee",
    });
    expect(data.labels[0]).not.toHaveProperty("svg");
    const replay = await request(body);
    expect(await replay.json()).toEqual(data);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM event_badge_credentials").first<{ n: number }>())?.n).toBe(
      1,
    );
  });
  it("refuses duplicate, missing or foreign registrations before issuing any badge", async () => {
    for (const registrationIds of [
      [registrationId, registrationId],
      [registrationId, crypto.randomUUID()],
    ]) {
      const response = await request({ ...input(), registrationIds });
      expect([400, 409]).toContain(response.status);
    }
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM event_badge_credentials").first<{ n: number }>())?.n).toBe(
      1,
    );
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='badge_label_batch_prepared'").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(0);
  });
  it("does not silently replace a revoked badge when retrying an existing operation", async () => {
    const body = input();
    const first = await request(body);
    expect(first.status).toBe(200);
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
      .bind(new Date().toISOString(), fixture.eventId)
      .run();
    expect((await request(body)).status).toBe(409);
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM event_badge_credentials").first<{ n: number }>())?.n).toBe(
      1,
    );
  });
  it.each(["cancelled", "inactive", "capture closed"])("refuses %s selections", async (failure) => {
    if (failure === "cancelled")
      await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE id=?").bind(registrationId).run();
    if (failure === "inactive") await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(fixture.userId).run();
    if (failure === "capture closed")
      await env.DB.prepare("UPDATE event_evidence_retention_state SET capture_closed_at=? WHERE event_id=?")
        .bind(new Date().toISOString(), fixture.eventId)
        .run();
    const response = await request(input());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "BADGE_BATCH_CHANGED" } });
  });
  it.each(["profile", "revocation", "registration", "role", "redaction"])(
    "guards %s changes during credential recovery",
    async (change) => {
      const raced = mutateBeforeMatchingQuery(
        env.DB,
        (sql) => sql.includes("FROM json_each(?) captured"),
        async () => {
          if (change === "profile")
            await env.DB.prepare("UPDATE users SET first_name='Changed' WHERE id=?").bind(fixture.userId).run();
          if (change === "revocation")
            await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
              .bind(new Date().toISOString(), fixture.eventId)
              .run();
          if (change === "registration")
            await env.DB.prepare("UPDATE registrations SET status='cancelled' WHERE id=?").bind(registrationId).run();
          if (change === "role")
            await env.DB.prepare(
              "INSERT INTO registration_badge_role_overrides(registration_id,role,set_by_user_id,created_at,updated_at) VALUES(?,'staff',?,?,?)",
            )
              .bind(registrationId, fixture.operatorId, new Date().toISOString(), new Date().toISOString())
              .run();
          if (change === "redaction")
            await env.DB.prepare("UPDATE users SET pii_redacted_at=? WHERE id=?")
              .bind(new Date().toISOString(), fixture.userId)
              .run();
        },
      );
      const response = await request(input(), fixture.token, raced);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "BADGE_BATCH_CHANGED" } });
    },
  );
  it("retries concurrent issuance through the permission-wrapped route and preserves the winning badge", async () => {
    await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE event_id=?")
      .bind(new Date().toISOString(), fixture.eventId)
      .run();
    let winner: Awaited<ReturnType<typeof issueBadge>> | undefined;
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("SELECT 1 WHERE EXISTS(SELECT 1 FROM events"),
      async () => {
        winner = await issueBadge(
          env.DB,
          fixture.eventId,
          fixture.operatorId,
          {
            userId: fixture.userId,
            reuseActive: true,
            operationId: crypto.randomUUID(),
          },
          env,
        );
      },
    );
    const body = input();
    const response = await request(body, fixture.token, db);
    expect(response.status).toBe(200);
    const data = badgeLabelBatchResponseSchema.parse(await response.json());
    expect(winner?.result).toBe("issued");
    expect(data.labels[0]).toMatchObject({ id: winner!.id, credential: winner!.credential });
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM event_badge_credentials WHERE event_id=?")
          .bind(fixture.eventId)
          .first<{ n: number }>()
      )?.n,
    ).toBe(2);
    expect(
      (
        await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='badge_label_batch_prepared'").first<{
          n: number;
        }>()
      )?.n,
    ).toBe(1);
    const replay = await request(body);
    expect(await replay.json()).toEqual(data);
  });
  it.each(["session", "permission"])("refuses %s loss before releasing QR credentials", async (kind) => {
    const db = mutateBeforeMatchingQuery(
      env.DB,
      (sql) => sql.includes("FROM json_each(?) captured"),
      async () => {
        const sql =
          kind === "session"
            ? "UPDATE sessions SET revoked_at=? WHERE user_id=?"
            : "UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'";
        await env.DB.prepare(sql).bind(new Date().toISOString(), fixture.operatorId).run();
      },
    );
    const response = await callApi({ ...env, DB: db as typeof env.DB }, endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${fixture.token}` },
      body: JSON.stringify(input()),
    });
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain(fixture.badgeId);
  });
  it("issues and reads 1000 attendees using bounded SQL and JSON parameters, with stable retries", async () => {
    const users = Array.from({ length: 1000 }, () => ({
      userId: crypto.randomUUID(),
      registrationId: crypto.randomUUID(),
    }));
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO users(id,email,normalized_email,first_name,last_name,active)
        SELECT json_extract(value,'$.userId'),json_extract(value,'$.userId')||'@example.test',json_extract(value,'$.userId')||'@example.test','Synthetic','Attendee',1 FROM json_each(?)`).bind(
        JSON.stringify(users),
      ),
      env.DB.prepare(`INSERT INTO registrations(id,event_id,user_id,status,source_type,manage_link_secret,created_at,updated_at)
        SELECT json_extract(value,'$.registrationId'),?,json_extract(value,'$.userId'),'registered','test',json_extract(value,'$.registrationId'),?,? FROM json_each(?)`).bind(
        fixture.eventId,
        now,
        now,
        JSON.stringify(users),
      ),
    ]);
    const sqlBytes: number[] = [],
      parameterCounts: number[] = [],
      valueBytes: number[] = [];
    const originals = new WeakMap<StatementLike, StatementLike>();
    const encoder = new TextEncoder();
    const wrap = (statement: StatementLike): StatementLike => {
      const wrapped: StatementLike = {
        bind(...values) {
          parameterCounts.push(values.length);
          for (const value of values) if (typeof value === "string") valueBytes.push(encoder.encode(value).byteLength);
          return wrap(statement.bind(...values));
        },
        run: () => statement.run(),
        all: () => statement.all(),
        first: (column) => statement.first(column),
      };
      originals.set(wrapped, statement);
      return wrapped;
    };
    let batchCalls = 0;
    const measured: DatabaseLike = {
      prepare(sql) {
        sqlBytes.push(encoder.encode(sql).byteLength);
        return wrap(env.DB.prepare(sql));
      },
      batch(statements) {
        batchCalls++;
        return env.DB.batch(statements.map((statement) => originals.get(statement)!));
      },
    };
    const body = { ...input(), registrationIds: users.map((row) => row.registrationId) };
    const first = await prepareBadgeLabelBatch(measured, env, fixture.eventId, fixture.operatorId, body);
    expect(first.labels).toHaveLength(1000);
    expect(batchCalls).toBe(3);
    expect(sqlBytes.length).toBeLessThan(25);
    expect(Math.max(...sqlBytes)).toBeLessThan(100_000);
    expect(Math.max(...parameterCounts)).toBeLessThan(100);
    expect(Math.max(...valueBytes)).toBeLessThan(2_000_000);
    const replay = await prepareBadgeLabelBatch(measured, env, fixture.eventId, fixture.operatorId, body);
    expect(replay).toEqual(first);
    const httpProfile = profileD1Flow(env.DB, { measurePayloadBytes: true });
    const response = await request(body, fixture.token, httpProfile.db);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(first);
    const profile = httpProfile.summary();
    expect(profile.queries.every((query) => query.requestBytes! < 1_500_000 && query.resultBytes! < 1_000_000)).toBe(
      true,
    );
    console.info("Mounted 1000-label replay D1 budget", {
      roundTrips: profile.roundTrips,
      statements: profile.statements,
      maxRequestBytes: Math.max(...profile.queries.map((query) => query.requestBytes!)),
      maxResultBytes: Math.max(...profile.queries.map((query) => query.resultBytes!)),
    });
    expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM event_badge_credentials").first<{ n: number }>())?.n).toBe(
      1001,
    );
    expect(
      (await env.DB.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action='badge_issued'").first<{ n: number }>())
        ?.n,
    ).toBe(1001);
    expect((await request({ ...body, registrationIds: body.registrationIds.slice(1) })).status).toBe(409);
  }, 60_000);
});
