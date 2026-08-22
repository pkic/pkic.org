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
});
