import { describe, expect, it, vi } from "vitest";
import { createD1QueryBudgetedDatabase, D1QueryBudgetExceededError } from "../functions/_lib/db/query-budget";
import type { DatabaseLike, StatementLike } from "../functions/_lib/types";

function fakeDatabase(): { db: DatabaseLike; batch: ReturnType<typeof vi.fn> } {
  const statement = (): StatementLike => {
    const prepared = {} as StatementLike;
    prepared.bind = vi.fn(() => prepared);
    prepared.run = vi.fn().mockResolvedValue({ success: true });
    prepared.all = vi.fn().mockResolvedValue({ results: [] });
    prepared.first = vi.fn().mockResolvedValue(null);
    return prepared;
  };
  const batch = vi.fn().mockResolvedValue([]);
  return { db: { prepare: vi.fn(() => statement()), batch }, batch };
}

describe("D1 query budget", () => {
  it("counts run, all, and first executions rather than prepare/bind calls", async () => {
    const raw = fakeDatabase();
    const { db, budget } = createD1QueryBudgetedDatabase(raw.db, 3);

    const prepared = db.prepare("SELECT ?").bind("value");
    expect(budget.usedQueries()).toBe(0);
    await prepared.run();
    await db.prepare("SELECT 1").all();
    await db.prepare("SELECT 1").first();
    expect(budget.usedQueries()).toBe(3);
    await expect(db.prepare("SELECT 1").run()).rejects.toBeInstanceOf(D1QueryBudgetExceededError);
  });

  it("counts every statement in a D1 batch and refuses the whole batch before execution", async () => {
    const raw = fakeDatabase();
    const { db, budget } = createD1QueryBudgetedDatabase(raw.db, 3);
    const two = [db.prepare("SELECT 1"), db.prepare("SELECT 2")];

    await db.batch(two);
    expect(budget.usedQueries()).toBe(2);
    await expect(db.batch(two)).rejects.toMatchObject({ requestedQueries: 2, remainingQueries: 1 });
    expect(raw.batch).toHaveBeenCalledTimes(1);
  });
});
