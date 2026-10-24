import {
  createResourceGrantFixture,
  insertResourceGrantActor,
  addResourceGrantParticipant,
} from "./helpers/resource-grant-fixture";
import {
  guardGroupResourceViewerDatabase,
  guardManagedGroupResourceDatabase,
} from "../functions/_lib/services/resource-grants";
import { guardEventResourceManagementDatabase } from "../functions/_lib/services/event-series/management";
import { guardGroupEventRegistrationDatabase } from "../functions/_lib/services/registrations/authorization";
import { participantSessionDatabase } from "../functions/_lib/services/event-participation/self-authorization";
import { createAdminSession } from "./helpers/auth";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { guardAuthorizedDatabase } from "../functions/_lib/db/authorization-guard";
import { isReadOnlySql } from "../functions/_lib/db/read-only-sql";
import { AppError } from "../functions/_lib/errors";
import { profileD1Flow } from "./helpers/d1-flow-profile";
import { insertUser } from "./helpers/membership";
import { resetDb } from "./helpers/reset-db";

beforeEach(resetDb);

it.each([
  ["SELECT 1", true],
  ["-- read\n WITH ids(id) AS (SELECT 1) SELECT id FROM ids;", true],
  ["SELECT 'DELETE; INSERT', \"UPDATE\", `DROP`, [ALTER] /* UPDATE */", true],
  ["WITH ids(id) AS (SELECT 1) UPDATE users SET active=0 RETURNING id", false],
  ["INSERT INTO users(id) VALUES (?) RETURNING id", false],
  ["SELECT 1; DELETE FROM users", false],
  ["PRAGMA user_version=1", false],
])("classifies internal SQL conservatively: %s", (sql, expected) => {
  expect(isReadOnlySql(sql)).toBe(expected);
});

async function fixture() {
  const id = await insertUser(env.DB);
  const profile = profileD1Flow(env.DB);
  const db = guardAuthorizedDatabase(
    profile.db,
    {
      sql: "SELECT 1 FROM users WHERE id=? AND active=1",
      bindings: [id],
    },
    () => new AppError(409, "AUTHORIZATION_CONTEXT_CHANGED", "Authorization changed"),
  );
  return { id, profile, db };
}

describe("replica-compatible authorization batches", () => {
  it("checks single and batched reads without any guard writes and preserves separate bindings", async () => {
    const { db, profile } = await fixture();
    const query = db.prepare("WITH requested(value) AS(SELECT ?) SELECT value FROM requested");
    const [left, right] = await db.batch([query.bind("left"), query.bind("right")]);
    expect(left!.results).toEqual([{ value: "left" }]);
    expect(right!.results).toEqual([{ value: "right" }]);
    expect(await db.prepare("SELECT ? AS value").bind("first").first("value")).toBe("first");
    expect((await db.prepare("SELECT 1 AS value").run()).results).toEqual([{ value: 1 }]);
    const report = await profile.report();
    expect(report.queries.every(({ sql }) => sql.startsWith("SELECT EXISTS"))).toBe(true);
    expect(report.queries.some(({ sql }) => sql.includes("INSERT INTO authorization_guards"))).toBe(false);
  });

  it("refuses protected read results once a revocation is visible in the serving database", async () => {
    const { db, id } = await fixture();
    await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(id).run();
    await expect(db.prepare("SELECT email FROM users WHERE id=?").bind(id).all()).rejects.toMatchObject({
      code: "AUTHORIZATION_CONTEXT_CHANGED",
    });
  });

  it("rolls back denied writes even through all() and in mixed read/write batches", async () => {
    const { db, id } = await fixture();
    await env.DB.prepare("UPDATE users SET active=0 WHERE id=?").bind(id).run();
    await expect(
      db.prepare("UPDATE users SET first_name='Denied' WHERE id=? RETURNING id").bind(id).all(),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_CONTEXT_CHANGED" });
    await expect(
      db.batch([
        db.prepare("SELECT id FROM users WHERE id=?").bind(id),
        db
          .prepare(
            "WITH target(id) AS(SELECT ?) UPDATE users SET first_name='Denied' WHERE id IN(SELECT id FROM target)",
          )
          .bind(id),
      ]),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_CONTEXT_CHANGED" });
    expect(await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(id).first("first_name")).not.toBe(
      "Denied",
    );
  });
});

it("keeps participant reads read-only and rolls back writes after session revocation", async () => {
  const userId = await insertUser(env.DB);
  await createAdminSession(env.DB, userId, crypto.randomUUID());
  const sessionId = await env.DB.prepare("SELECT id FROM sessions WHERE user_id=?").bind(userId).first<string>("id");
  const profile = profileD1Flow(env.DB);
  const guarded = participantSessionDatabase(profile.db, userId, sessionId!);
  expect(await guarded.prepare("SELECT id FROM users WHERE id=?").bind(userId).first("id")).toBe(userId);
  expect((await profile.report()).queries.some(({ sql }) => sql.includes("INSERT INTO authorization_guards"))).toBe(
    false,
  );
  await env.DB.prepare("UPDATE sessions SET revoked_at=? WHERE id=?").bind(new Date().toISOString(), sessionId).run();
  await expect(guarded.prepare("SELECT id FROM users WHERE id=?").bind(userId).all()).rejects.toThrow(
    "AUTHORIZATION_CONTEXT_CHANGED",
  );
  await expect(guarded.prepare("UPDATE users SET first_name='Denied' WHERE id=?").bind(userId).run()).rejects.toThrow(
    "AUTHORIZATION_CONTEXT_CHANGED",
  );
  expect(await env.DB.prepare("SELECT first_name FROM users WHERE id=?").bind(userId).first("first_name")).not.toBe(
    "Denied",
  );
});

it("keeps shared resource, management, attendance, and registration reads free of primary guard writes", async () => {
  const f = await createResourceGrantFixture();
  const admin = await insertResourceGrantActor("replica-reader", "admin");
  const participant = await addResourceGrantParticipant(f.owner.id, "replica-participant");
  await env.DB.prepare("UPDATE events SET registration_mode='invite_or_open' WHERE id=?").bind(f.eventId).run();
  const context = { eventId: f.eventId, groupId: f.owner.id };
  const profile = profileD1Flow(env.DB);
  const readers = [
    guardGroupResourceViewerDatabase(profile.db, { userId: admin.id, admin }, f.owner.id, "event", f.eventId, "view"),
    guardManagedGroupResourceDatabase(profile.db, admin, f.owner.id, "event", f.eventId, "manage"),
    guardEventResourceManagementDatabase(profile.db, admin, context, "manage_attendance"),
    guardGroupEventRegistrationDatabase(profile.db, { ...context, userId: participant.id }),
  ];
  for (const db of readers)
    expect(await db.prepare("SELECT id FROM events WHERE id=?").bind(f.eventId).first("id")).toBe(f.eventId);
  const report = await profile.report();
  expect(report.roundTrips).toBe(readers.length);
  expect(report.executedSql.every(isReadOnlySql)).toBe(true);
});
