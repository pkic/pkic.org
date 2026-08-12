import { env } from "cloudflare:workers";

interface TableNameRow {
  name: string;
}

// `roles` / `role_permissions` are system reference data —
// built-in roles "ship with the portal" and are seeded once by migration
// 0035, not per-test business data (unlike e.g. `working_groups`, which
// tests already re-seed themselves when they need it). Wiping them on every
// resetDb() would break the FK from `user_roles.role_id` for any test that
// grants a built-in role (e.g. via POST .../events/:slug/permissions)
// without every such test re-inserting all nine built-in roles itself.
// `membership_settings` (migration 0038) is a singleton
// configuration row seeded once by the migration — the same class of
// system reference data as roles/role_permissions above, not per-test
// business data. Every membership-workflow code path (stage transitions,
// scheduled jobs, the admin settings endpoint) expects this row to always
// exist; wiping it on every resetDb() would require every such test to
// re-seed it itself.
// `mailing_lists` (migration 0041) is the same class of system
// reference data — its 9 rows are seeded once by the migration, and
// membership-onboarding.ts's approveApplication now reads the all_members/
// consultation rows at runtime (resolveAutoSyncListEmails) instead of the
// hardcoded constants it used to have. Wiping it on every resetDb() would
// silently stop every pre-existing approval-flow test from enqueueing
// Google Groups sync for pkic@/consultation@, the same failure mode
// membership_settings' exclusion already guards against.
const EXCLUDED_TABLES = new Set(["d1_migrations", "roles", "role_permissions", "membership_settings", "mailing_lists"]);

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
 * `membership_settings` is excluded from wiping (see above) but its
 * `updated_by_user_id` FK can point at a `users` row from a previous test,
 * which would otherwise block that table's DELETE below. Cleared first,
 * before the generic table-clearing pass, so the singleton row itself
 * survives but never holds a dangling actor reference.
 */
async function clearMembershipSettingsActorReference(): Promise<void> {
  await env.DB.prepare(`UPDATE membership_settings SET updated_by_user_id = NULL WHERE id = 'default'`).run();
}

/**
 * Clears all domain data from the test database while preserving the schema
 * and the D1 migration tracking table.  Call inside `beforeEach` in test files
 * that create multiple independent DB scenarios.
 */
export async function resetDb(): Promise<void> {
  await clearMembershipSettingsActorReference();
  const tableNames = await listResettableTables();
  await clearTablesWithRetry(tableNames);
}
