import { env } from "cloudflare:workers";

interface TableNameRow {
  name: string;
}

// `roles` / `role_permissions` are Phase 2 (PRD §2) system reference data —
// built-in roles "ship with the portal" and are seeded once by migration
// 0035, not per-test business data (unlike e.g. `working_groups`, which
// tests already re-seed themselves when they need it). Wiping them on every
// resetDb() would break the FK from `user_roles.role_id` for any test that
// grants a built-in role (e.g. via POST .../events/:slug/permissions)
// without every such test re-inserting all nine built-in roles itself.
const EXCLUDED_TABLES = new Set(["d1_migrations", "roles", "role_permissions"]);

async function listResettableTables(): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`,
  ).all<TableNameRow>();

  return results
    .map((row: TableNameRow) => row.name)
    .filter((name: string) => !name.startsWith("_cf_"))
    .filter((name: string) => !EXCLUDED_TABLES.has(name));
}

async function clearTablesWithRetry(tableNames: string[]): Promise<void> {
  const pending = new Set(tableNames);

  // Re-try deletes so FK parents are attempted after children are cleared.
  while (pending.size > 0) {
    let deletedInPass = 0;

    for (const tableName of Array.from(pending)) {
      try {
        await env.DB.prepare(`DELETE FROM "${tableName}"`).run();
        pending.delete(tableName);
        deletedInPass += 1;
      } catch {
        // Leave table pending for the next pass (usually FK order related).
      }
    }

    if (deletedInPass === 0) {
      throw new Error(
        `resetDb: could not clear tables due to unresolved FK dependencies: ${Array.from(pending).join(", ")}`,
      );
    }
  }
}

/**
 * Clears all domain data from the test database while preserving the schema
 * and the D1 migration tracking table.  Call inside `beforeEach` in test files
 * that create multiple independent DB scenarios.
 */
export async function resetDb(): Promise<void> {
  const tableNames = await listResettableTables();
  await clearTablesWithRetry(tableNames);
}
