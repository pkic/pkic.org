import { describe, expect, it } from "vitest";
import {
  D1_MAX_STATEMENT_BYTES,
  insertStatements,
  ROWS_PER_STATEMENT,
  workerAdminEmails,
} from "../../scripts/seed-initial-admin.mjs";

/**
 * The worker pool is scenarios × cores, so the SQL this seeder writes grows on
 * two axes at once. Built as a single statement it reached 105KB on a ten-core
 * machine and SQLite refused it — `statement too long: SQLITE_TOOBIG` — which
 * surfaced as the whole e2e harness failing to start, several steps away from
 * the scope that had just been added.
 */
describe("initial admin seed SQL", () => {
  it("keeps every statement well inside D1's documented ceiling, whatever the pool size", () => {
    const statements = insertStatements(workerAdminEmails());
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      // A quarter of the limit, so a machine with far more cores than this one
      // does not rediscover the failure.
      expect(Buffer.byteLength(statement)).toBeLessThan(D1_MAX_STATEMENT_BYTES / 4);
    }
  });

  it("stays inside the ceiling even for a pool far larger than this machine's", () => {
    // The pool is scenarios × workers. Sizing it for a 64-worker machine is
    // the case that broke before, reached one axis at a time.
    const huge = Array.from({ length: 20_000 }, (_, index) => `admin.scenario-${String(index)}.w63@pkic.org`);
    for (const statement of insertStatements(huge)) {
      expect(Buffer.byteLength(statement)).toBeLessThan(D1_MAX_STATEMENT_BYTES);
    }
  });

  it("writes every address exactly once, across the chunks", () => {
    const emails = workerAdminEmails();
    const statements = insertStatements(emails);
    expect(statements).toHaveLength(Math.ceil(emails.length / ROWS_PER_STATEMENT));

    const written = statements.flatMap((statement) => [...statement.matchAll(/'([^']+@pkic\.org)'/g)].map((m) => m[1]));
    // Each row names the address twice — as `email` and as `normalized_email`.
    expect(new Set(written)).toEqual(new Set(emails));
    expect(written).toHaveLength(emails.length * 2);
  });

  it("upserts rather than failing on a database that already has the pool", () => {
    for (const statement of insertStatements(["admin@pkic.org"])) {
      expect(statement).toContain("ON CONFLICT(email) DO UPDATE SET");
    }
  });
});
