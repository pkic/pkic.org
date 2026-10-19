import { beforeEach, describe, expect, it } from "vitest";
import { grantAdministrator } from "./helpers/administrator";
import { env } from "cloudflare:workers";
import {
  badgeCredentialMetadataSchema,
  badgeCredentialsQuerySchema,
  badgeCredentialsResponseSchema,
  badgeIssueRequestSchema,
  badgeIssueResponseSchema,
  type BadgeIssueRequest,
} from "../assets/shared/schemas/route-contracts-event-badges";
import { createEventScannerFixture } from "./helpers/event-scanner-fixture";
import { callApi } from "./helpers/app";
import { createAdminSession } from "./helpers/auth";
import { mutateBeforeNextBatch } from "./helpers/database-races";
import type { DatabaseLike } from "../functions/_lib/types";
import { offlineEligibility } from "../functions/_lib/services/event-participation/offline-eligibility";
import { hashBadgeCredential } from "../functions/_lib/services/event-participation/badge-hash";
import { listBadgeCredentials } from "../functions/_lib/services/event-participation/badge-credentials";

const fixture = createEventScannerFixture();
const base = "/api/v1/events/scan-test/badges";
function input(changes: Partial<BadgeIssueRequest> = {}) {
  return badgeIssueRequestSchema.parse({ userId: fixture.userId, operationId: crypto.randomUUID(), ...changes });
}
function request(path: string, init: RequestInit = {}, db: DatabaseLike = env.DB, token = fixture.token) {
  return callApi({ ...env, DB: db }, path, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
}
const post = (body = input(), db: DatabaseLike = env.DB) =>
  request(base, { method: "POST", body: JSON.stringify(body) }, db);
async function issued(changes: Partial<BadgeIssueRequest> = {}) {
  const response = await post(input(changes));
  expect(response.status, await response.clone().text()).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const result = badgeIssueResponseSchema.parse(await response.json());
  if (result.result !== "issued") throw new Error("Expected fresh issuance");
  return result;
}
async function original() {
  return (await env.DB.prepare("SELECT id FROM event_badge_credentials WHERE event_id=? AND credential_hash=?")
    .bind(fixture.eventId, await hashBadgeCredential(fixture.badgeId))
    .first<{ id: string }>())!.id;
}
async function effects() {
  return Promise.all(
    [
      "SELECT id,event_id,user_id,credential_hash,created_at,expires_at,revoked_at FROM event_badge_credentials ORDER BY id",
      "SELECT id,actor_id,action,entity_id,details_json,idempotency_key,scope_type,scope_id FROM audit_log ORDER BY id",
      "SELECT event_id,generation,active_run_id,capture_closed_at FROM event_evidence_retention_state ORDER BY event_id",
      "SELECT id,status,attendance_type FROM registrations ORDER BY id",
      "SELECT id,status,approval_state FROM agenda_session_participations ORDER BY id",
      "SELECT id FROM event_attendance_observations ORDER BY id",
      "SELECT id FROM event_session_admissions ORDER BY id",
    ].map(async (sql) => (await env.DB.prepare(sql).all()).results),
  );
}
async function registeredPerson() {
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await env.DB.prepare(
    "INSERT INTO users(id,email,normalized_email,active,first_name,last_name) VALUES(?,?,?,1,'Grace','Hopper')",
  )
    .bind(id, `${id}@example.test`, `${id}@example.test`)
    .run();
  await env.DB.prepare(
    "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
  )
    .bind(crypto.randomUUID(), fixture.eventId, id, crypto.randomUUID(), now, now)
    .run();
  return id;
}
/** Arm only the actual lifecycle write, after all mounted authorization/service preflight reads. */
function race(mutation: () => Promise<unknown>) {
  let armed = false;
  const raced = mutateBeforeNextBatch(env.DB, mutation);
  return {
    prepare(sql: string) {
      if (
        sql.startsWith("INSERT INTO event_badge_credentials") ||
        sql.startsWith("UPDATE event_badge_credentials SET revoked_at")
      )
        armed = true;
      return env.DB.prepare(sql);
    },
    batch: (statements) => (armed ? raced : env.DB).batch(statements),
  } satisfies DatabaseLike;
}
describe("Event-owned badge lifecycle", () => {
  beforeEach(async () => {
    await fixture.setup();
    await env.DB.prepare("UPDATE users SET first_name='Augusta',preferred_name='Ada',last_name='Lovelace' WHERE id=?")
      .bind(fixture.userId)
      .run();
  });
  it("lists an event-wide bounded inventory with server person/status/search filters and no bearer data", async () => {
    await issued();
    const other = await registeredPerson();
    await issued({ userId: other });
    const response = await request(`${base}?limit=2&sort=displayName`);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const first = badgeCredentialsResponseSchema.parse(await response.json());
    expect(first.page).toMatchObject({ total: 3, hasMore: true });
    expect(first.badges.map((badge) => badge.displayName)).toEqual(["Ada Lovelace", "Ada Lovelace"]);
    const last = badgeCredentialsResponseSchema.parse(
      await (await request(`${base}?limit=2&offset=2&sort=displayName`)).json(),
    );
    expect(last.page).toMatchObject({ total: 3, hasMore: false });
    expect(last.badges.map((badge) => badge.displayName)).toEqual(["Grace Hopper"]);
    const filtered = badgeCredentialsResponseSchema.parse(
      await (await request(`${base}?userId=${other}&status=active&q=Grace`)).json(),
    );
    expect(filtered.page.total).toBe(1);
    expect(filtered.badges[0]?.userId).toBe(other);
    const empty = badgeCredentialsResponseSchema.parse(await (await request(`${base}?q=Nobody`)).json());
    expect(empty).toMatchObject({ badges: [], page: { total: 0, hasMore: false } });
    const text = JSON.stringify(first);
    for (const forbidden of ["credentialHash", "credential_hash", "@example.test", fixture.badgeId])
      expect(text).not.toContain(forbidden);
  });
  it("reads only exact event-owned metadata and derives expired/revoked status", async () => {
    const id = await original();
    await env.DB.prepare("UPDATE event_badge_credentials SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .bind(id)
      .run();
    const response = await request(`${base}/${id}`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(badgeCredentialMetadataSchema.parse(await response.json())).toMatchObject({
      id,
      status: "expired",
      displayName: "Ada Lovelace",
    });
    expect((await request(`${base}/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(badgeCredentialMetadataSchema.parse(await (await request(`${base}/${id}`)).json()).status).toBe("revoked");
    expect(
      badgeCredentialsResponseSchema.parse(await (await request(`${base}?status=revoked`)).json()).page.total,
    ).toBe(1);
    expect((await request(`${base}/${crypto.randomUUID()}`)).status).toBe(404);
    const otherEvent = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,registration_mode,settings_json,created_at,updated_at) VALUES(?,'other-badge-event','Other event','UTC','invite_or_open','{}',?,?)",
    )
      .bind(otherEvent, now, now)
      .run();
    expect((await request(`/api/v1/events/other-badge-event/badges/${id}`)).status).toBe(404);
    expect((await request(`/api/v1/events/other-badge-event/badges/${id}`, { method: "DELETE" })).status).toBe(404);
    await env.DB.prepare("UPDATE event_badge_credentials SET event_id=? WHERE id=?").bind(otherEvent, id).run();
    const before = await effects();
    expect((await post(input({ replaceBadgeId: id }))).status).toBe(404);
    expect(await effects()).toEqual(before);
  });
  it("uses a fixed page/count pair rather than a person lookup for each badge", async () => {
    for (let index = 0; index < 4; index++) await issued();
    const prepared: string[] = [];
    const db: DatabaseLike = {
      prepare(sql) {
        prepared.push(sql);
        return env.DB.prepare(sql);
      },
      batch: (statements) => env.DB.batch(statements),
    };
    const page = await listBadgeCredentials(db, fixture.eventId, badgeCredentialsQuerySchema.parse({ limit: 3 }));
    expect(page.page).toMatchObject({ total: 5, hasMore: true });
    expect(prepared).toHaveLength(2);
    expect(prepared.every((sql) => sql.includes("JOIN users person"))).toBe(true);
  });
  it.each(["redacted", "retention"] as const)(
    "keeps metadata manageable without disclosing or searching a %s personal label",
    async (kind) => {
      if (kind === "redacted")
        await env.DB.prepare("UPDATE users SET pii_redacted_at=? WHERE id=?")
          .bind(new Date().toISOString(), fixture.userId)
          .run();
      else
        await env.DB.prepare("INSERT INTO event_contact_retention_state(event_id,closed_at,deadline_at) VALUES(?,?,?)")
          .bind(fixture.eventId, new Date().toISOString(), new Date().toISOString())
          .run();
      const all = badgeCredentialsResponseSchema.parse(await (await request(base)).json());
      expect(all.badges[0]?.displayName).toBeNull();
      const searched = badgeCredentialsResponseSchema.parse(await (await request(`${base}?q=Ada`)).json());
      expect(searched.badges).toEqual([]);
      expect((await request(`${base}/${all.badges[0]!.id}`, { method: "DELETE" })).status).toBe(200);
    },
  );
  it("atomically replaces exactly the selected credential while preserving independent credentials, scans and capacity", async () => {
    const independent = await issued(),
      previous = await original();
    const registrationBefore = (await env.DB.prepare("SELECT id,status FROM registrations ORDER BY id").all()).results;
    const replacement = await issued({ replaceBadgeId: previous });
    expect(replacement.replacedBadgeId).toBe(previous);
    const fresh = await offlineEligibility(env.DB, fixture.eventId, fixture.operatorId, {});
    expect(fresh.entries.find((entry) => entry.badgeId === previous)?.revoked).toBe(true);
    expect(fresh.entries.find((entry) => entry.badgeId === independent.id)?.revoked).toBe(false);
    expect(fresh.entries.find((entry) => entry.badgeId === replacement.id)?.credentialHash).toBe(
      await hashBadgeCredential(replacement.credential),
    );
    expect(
      await (await fixture.scan(fixture.scanBody({ action: "attendance", occurrenceId: null }))).json(),
    ).toMatchObject({ reason: "revoked_badge", recorded: true, attendanceRecorded: false });
    for (const credential of [replacement.credential, independent.credential])
      expect(
        await (
          await fixture.scan(fixture.scanBody({ badgeId: credential, action: "attendance", occurrenceId: null }))
        ).json(),
      ).toMatchObject({ reason: "eligible", attendanceRecorded: true, admissionRecorded: false });
    expect((await env.DB.prepare("SELECT id,status FROM registrations ORDER BY id").all()).results).toEqual(
      registrationBefore,
    );
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM agenda_session_participations").first()).toEqual({
      count: 0,
    });
    const audits = (
      await env.DB.prepare(
        "SELECT actor_id,scope_type,scope_id,details_json FROM audit_log WHERE action LIKE 'badge_%'",
      ).all()
    ).results;
    expect(
      audits.every(
        (row) => row.actor_id === fixture.operatorId && row.scope_type === "event" && row.scope_id === fixture.eventId,
      ),
    ).toBe(true);
    const auditText = JSON.stringify(audits);
    expect(auditText).not.toContain(replacement.credential);
    expect(auditText).not.toContain(await hashBadgeCredential(replacement.credential));
    expect(auditText).not.toContain("Ada");
  });
  it("returns a metadata-only completed retry and refuses operation reuse without another credential or audit", async () => {
    const body = input(),
      response = await post(body),
      issuedValue = badgeIssueResponseSchema.parse(await response.json());
    const before = await effects();
    const replay = await post(body);
    expect(replay.status).toBe(200);
    expect(badgeIssueResponseSchema.parse(await replay.json())).toMatchObject({
      result: "replayed",
      id: issuedValue.id,
      credential: null,
    });
    expect((await post({ ...body, expiresAt: "2099-01-01T00:00:00.000Z" })).status).toBe(409);
    expect(await effects()).toEqual(before);
  });
  it("replays a completed replacement without reviving or redisclosing either credential", async () => {
    const previous = await original(),
      body = input({ replaceBadgeId: previous });
    const initial = badgeIssueResponseSchema.parse(await (await post(body)).json());
    const before = await effects(),
      replay = await post(body);
    expect(replay.status).toBe(200);
    expect(badgeIssueResponseSchema.parse(await replay.json())).toMatchObject({
      result: "replayed",
      id: initial.id,
      credential: null,
      replacedBadgeId: previous,
    });
    expect(await effects()).toEqual(before);
    expect(
      (await env.DB.prepare("SELECT revoked_at FROM event_badge_credentials WHERE id=?")
        .bind(previous)
        .first<{ revoked_at: string | null }>())!.revoked_at,
    ).not.toBeNull();
  });
  it("binds completed operation receipts to the exact authenticated actor", async () => {
    const body = input();
    expect((await post(body)).status).toBe(200);
    const other = await registeredPerson();
    await grantAdministrator(env.DB, other);
    const token = await createAdminSession(env.DB, other, crypto.randomUUID()),
      before = await effects();
    const response = await request(base, { method: "POST", body: JSON.stringify(body) }, env.DB, token);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "BADGE_OPERATION_REUSED" } });
    expect(await effects()).toEqual(before);
  });
  it("explicitly replaces an expired owned credential without changing the expiry policy", async () => {
    const previous = await original();
    await env.DB.prepare("UPDATE event_badge_credentials SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?")
      .bind(previous)
      .run();
    const replacement = await issued({ replaceBadgeId: previous });
    expect(Date.parse(replacement.expiresAt)).toBeGreaterThan(Date.now());
    expect(badgeCredentialMetadataSchema.parse(await (await request(`${base}/${previous}`)).json()).status).toBe(
      "revoked",
    );
  });
  it("deduplicates concurrent identical issuance and permits one winner for concurrent selected replacement", async () => {
    const body = input(),
      same = await Promise.all([post(body), post(body)]);
    expect(same.map((response) => response.status)).toEqual([200, 200]);
    const results = await Promise.all(
      same.map(async (response) => badgeIssueResponseSchema.parse(await response.json())),
    );
    expect(new Set(results.map((result) => result.id)).size).toBe(1);
    expect(results.filter((result) => result.result === "issued")).toHaveLength(1);
    const previous = await original(),
      replacements = await Promise.all([
        post(input({ replaceBadgeId: previous })),
        post(input({ replaceBadgeId: previous })),
      ]);
    expect(replacements.map((response) => response.status).sort()).toEqual([200, 409]);
    expect(await env.DB.prepare("SELECT COUNT(*) AS count FROM event_badge_credentials").first()).toEqual({ count: 3 });
  });
  it("refuses another attendee's selected credential, unknown predecessors and repeated replacement without effects", async () => {
    const previous = await original(),
      other = await registeredPerson(),
      before = await effects();
    expect((await post(input({ userId: other, replaceBadgeId: previous }))).status).toBe(409);
    expect((await post(input({ replaceBadgeId: crypto.randomUUID() }))).status).toBe(404);
    expect(await effects()).toEqual(before);
    await issued({ replaceBadgeId: previous });
    const after = await effects();
    expect((await post(input({ replaceBadgeId: previous }))).status).toBe(409);
    expect(await effects()).toEqual(after);
  });
  it("revokes a prior issued row after metadata reload and preserves the first revocation on retry", async () => {
    const value = await issued(),
      path = `${base}/${value.id}`;
    expect((await request(path)).status).toBe(200);
    expect((await request(path, { method: "DELETE" })).status).toBe(200);
    const before = await effects();
    expect((await request(path, { method: "DELETE" })).status).toBe(200);
    expect(await effects()).toEqual(before);
  });
  it("keeps explicit expiry canonical and refuses invalid contracts or unregistered issuance without writes", async () => {
    expect((await issued({ expiresAt: "2099-01-01T00:00:00.000Z" })).expiresAt).toBe("2099-01-01T00:00:00.000Z");
    const before = await effects();
    expect((await post(input({ expiresAt: "2000-01-01T00:00:00.000Z" }))).status).toBe(400);
    expect((await post(input({ userId: fixture.operatorId }))).status).toBe(409);
    expect((await request(base, { method: "POST", body: JSON.stringify({ userId: fixture.userId }) })).status).toBe(
      400,
    );
    expect((await request(`${base}?limit=201`)).status).toBe(400);
    expect((await request(`${base}?sort=credentialHash`)).status).toBe(400);
    expect(await effects()).toEqual(before);
  });
  it("requires the existing event management permission for every metadata and mutation endpoint", async () => {
    const token = await createAdminSession(env.DB, fixture.userId, crypto.randomUUID()),
      id = await original(),
      before = await effects();
    for (const [path, init] of [
      [base, {}],
      [`${base}/${id}`, {}],
      [base, { method: "POST", body: JSON.stringify(input()) }],
      [`${base}/${id}`, { method: "DELETE" }],
    ] as const)
      expect((await request(path, init, env.DB, token)).status).toBe(403);
    expect(await effects()).toEqual(before);
  });
  it.each(["session", "actor", "registration", "predecessor", "owner", "expiry", "event"] as const)(
    "rolls back the complete replacement command after a commit-time %s change",
    async (change) => {
      const previous = await original();
      let authoritative = await effects();
      const db = race(async () => {
        if (change === "session")
          await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE user_id=?")
            .bind(new Date().toISOString(), fixture.operatorId)
            .run();
        else if (change === "actor")
          await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(fixture.operatorId).run();
        else if (change === "registration")
          await env.DB.prepare("DELETE FROM registrations WHERE event_id=? AND user_id=?")
            .bind(fixture.eventId, fixture.userId)
            .run();
        else if (change === "predecessor")
          await env.DB.prepare("UPDATE event_badge_credentials SET revoked_at=? WHERE id=?")
            .bind(new Date().toISOString(), previous)
            .run();
        else if (change === "owner")
          await env.DB.prepare("UPDATE event_badge_credentials SET user_id=? WHERE id=?")
            .bind(fixture.operatorId, previous)
            .run();
        else if (change === "expiry")
          await env.DB.prepare("UPDATE event_badge_credentials SET expires_at='2099-01-01T00:00:00.000Z' WHERE id=?")
            .bind(previous)
            .run();
        else
          await env.DB.prepare("UPDATE events SET ends_at='2099-01-01T00:00:00.000Z' WHERE id=?")
            .bind(fixture.eventId)
            .run();
        authoritative = await effects();
      });
      const response = await post(input({ replaceBadgeId: previous }), db);
      expect(response.status, await response.clone().text()).toBe(
        change === "session" || change === "actor" ? 403 : 409,
      );
      expect(await effects()).toEqual(authoritative);
    },
  );
  it("rejects a revoked event-management grant at the final replacement boundary", async () => {
    const previous = await original(),
      grantId = crypto.randomUUID(),
      now = new Date().toISOString();
    await env.DB.prepare("UPDATE user_roles SET revoked_at=? WHERE user_id=? AND role_id='role-admin'")
      .bind(new Date().toISOString(), fixture.operatorId)
      .run();
    await env.DB.prepare(
      "INSERT INTO registrations(id,event_id,user_id,status,attendance_type,source_type,manage_link_secret,created_at,updated_at) VALUES(?,?,?,'registered','in_person','test',?,?,?)",
    )
      .bind(crypto.randomUUID(), fixture.eventId, fixture.operatorId, crypto.randomUUID(), now, now)
      .run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES(?,?,'events:manage','event',?,?)",
    )
      .bind(grantId, fixture.operatorId, fixture.eventId, now)
      .run();
    let authoritative = await effects();
    const db = race(async () => {
      await env.DB.prepare("UPDATE permission_grants SET revoked_at=? WHERE id=?").bind(now, grantId).run();
      authoritative = await effects();
    });
    expect((await post(input({ replaceBadgeId: previous }), db)).status).toBe(403);
    expect(await effects()).toEqual(authoritative);
  });
  it("rejects revocation after the authenticated management session expires with no audit fallout", async () => {
    const previous = await original();
    let authoritative = await effects();
    const db = race(async () => {
      await env.DB.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE user_id=?")
        .bind(fixture.operatorId)
        .run();
      authoritative = await effects();
    });
    expect((await request(`${base}/${previous}`, { method: "DELETE" }, db)).status).toBe(403);
    expect(await effects()).toEqual(authoritative);
  });
  it.each(["issue", "replace", "revoke"] as const)(
    "preserves the terminal evidence-purge fence for %s and rolls back all audits",
    async (action) => {
      const previous = await original();
      await env.DB.prepare("UPDATE event_evidence_retention_state SET capture_closed_at=? WHERE event_id=?")
        .bind(new Date().toISOString(), fixture.eventId)
        .run();
      const before = await effects();
      const response =
        action === "revoke"
          ? await request(`${base}/${previous}`, { method: "DELETE" })
          : await post(input(action === "replace" ? { replaceBadgeId: previous } : {}));
      expect(response.status).toBe(409);
      expect(await effects()).toEqual(before);
    },
  );
});
