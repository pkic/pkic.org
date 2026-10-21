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
