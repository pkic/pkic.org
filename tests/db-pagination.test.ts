import { describe, expect, it, vi } from "vitest";
import { queryPage } from "../functions/_lib/db/pagination";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";

function fakeDatabase(results: Array<{ results: Array<Record<string, unknown>> }>) {
  const preparedSql: string[] = [];
  const boundValues: unknown[][] = [];
  const batch = vi.fn().mockResolvedValue(results);
  const db: DatabaseLike = {
    prepare(sql: string): StatementLike {
      preparedSql.push(sql);
      const statement = {} as StatementLike;
      statement.bind = vi.fn((...values: unknown[]) => {
        boundValues.push(values);
        return statement;
      });
      statement.run = vi.fn();
      statement.all = vi.fn();
      statement.first = vi.fn();
      return statement;
    },
    batch,
  };
  return { db, batch, preparedSql, boundValues };
}

describe("shared D1 offset pagination", () => {
  it("derives page and count SQL from one unpaginated query and binding set", async () => {
    const fake = fakeDatabase([{ results: [{ id: "row-1" }] }, { results: [{ total: 7 }] }]);

    const result = await queryPage<{ id: string }>(fake.db, {
      sql: "SELECT id FROM records WHERE state = ?;",
      bindings: ["active"],
      orderBy: "ORDER BY id ASC",
      limit: 2,
      offset: 4,
    });

    expect(result).toEqual({ rows: [{ id: "row-1" }], total: 7 });
    expect(fake.preparedSql).toEqual([
      "SELECT id FROM records WHERE state = ?\nORDER BY id ASC\nLIMIT ? OFFSET ?",
      "SELECT COUNT(*) AS total FROM (SELECT id FROM records WHERE state = ?) AS query_page_rows",
    ]);
    expect(fake.boundValues).toEqual([["active", 2, 4], ["active"]]);
    expect(fake.batch).toHaveBeenCalledTimes(1);
  });

  it("derives a lean count from the canonical source without repeating the page projection", async () => {
    const fake = fakeDatabase([{ results: [{ id: "row-1" }] }, { results: [{ total: 1 }] }]);

    await queryPage<{ id: string }>(fake.db, {
      source: {
        selectSql: "SELECT r.id, u.email",
        fromSql: "FROM records r JOIN users u ON u.id = r.user_id WHERE r.state = ?",
        bindings: ["active"],
      },
      orderBy: "ORDER BY r.id ASC",
      limit: 1,
      offset: 0,
    });

    expect(fake.preparedSql).toEqual([
      "SELECT r.id, u.email\nFROM records r JOIN users u ON u.id = r.user_id WHERE r.state = ?\nORDER BY r.id ASC\nLIMIT ? OFFSET ?",
      "SELECT COUNT(*) AS total\nFROM records r JOIN users u ON u.id = r.user_id WHERE r.state = ?",
    ]);
    expect(fake.boundValues).toEqual([["active", 1, 0], ["active"]]);
  });

  it("shares a CTE prefix between page and lean count statements", async () => {
    const fake = fakeDatabase([{ results: [{ id: "row-1" }] }, { results: [{ total: 1 }] }]);

    await queryPage<{ id: string }>(fake.db, {
      source: {
        withSql: "WITH scoped AS (SELECT id FROM records WHERE state = ?)",
        selectSql: "SELECT scoped.id, expensive.payload",
        fromSql: "FROM scoped LEFT JOIN expensive ON expensive.id = scoped.id",
        countSelectSql: "SELECT COUNT(*) AS total",
        countFromSql: "FROM scoped",
        bindings: ["active"],
      },
      limit: 1,
      offset: 0,
    });

    expect(fake.preparedSql).toEqual([
      "WITH scoped AS (SELECT id FROM records WHERE state = ?)\nSELECT scoped.id, expensive.payload\nFROM scoped LEFT JOIN expensive ON expensive.id = scoped.id\nLIMIT ? OFFSET ?",
      "WITH scoped AS (SELECT id FROM records WHERE state = ?)\nSELECT COUNT(*) AS total\nFROM scoped",
    ]);
    expect(fake.boundValues).toEqual([["active", 1, 0], ["active"]]);
  });

  it("supports a lean count source while retaining one canonical page predicate", async () => {
    const fake = fakeDatabase([{ results: [{ id: "row-1" }] }, { results: [{ total: 1 }] }]);

    await queryPage<{ id: string }>(fake.db, {
      source: {
        selectSql: "SELECT r.id, review.payload",
        fromSql:
          "FROM records r LEFT JOIN heavy_review_projection review ON review.id = r.id WHERE r.state = ? AND r.event_id = ?",
        countFromSql: "FROM records r WHERE r.state = ? AND r.event_id = ?",
        bindings: ["active", "event-1"],
      },
      orderBy: "ORDER BY r.id ASC",
      limit: 1,
      offset: 0,
    });

    expect(fake.preparedSql[1]).toBe("SELECT COUNT(*) AS total\nFROM records r WHERE r.state = ? AND r.event_id = ?");
    expect(fake.boundValues).toEqual([
      ["active", "event-1", 1, 0],
      ["active", "event-1"],
    ]);
  });

  it("allows count bindings to omit page-only placeholders", async () => {
    const fake = fakeDatabase([{ results: [{ id: "row-1" }] }, { results: [{ total: 1 }] }]);

    await queryPage<{ id: string }>(fake.db, {
      source: {
        selectSql: "SELECT r.id, review.payload",
        fromSql: "FROM records r LEFT JOIN heavy_review_projection review ON review.id = r.id WHERE r.event_id = ?",
        countFromSql: "FROM records r WHERE r.event_id = ?",
        bindings: ["event-1", "event-1"],
        countBindings: ["event-1"],
      },
      limit: 1,
      offset: 0,
    });

    expect(fake.boundValues).toEqual([["event-1", "event-1", 1, 0], ["event-1"]]);
  });

  it("rejects ambiguous or mixed legacy/source query definitions", async () => {
    const fake = fakeDatabase([]);
    await expect(
      queryPage(fake.db, {
        limit: 1,
        offset: 0,
      } as never),
    ).rejects.toThrow();
    await expect(
      queryPage(fake.db, {
        sql: "SELECT id FROM records",
        source: { selectSql: "SELECT id", fromSql: "FROM records" },
        limit: 1,
        offset: 0,
      } as never),
    ).rejects.toThrow();
  });
});
