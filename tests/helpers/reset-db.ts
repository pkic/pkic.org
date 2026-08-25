import { env } from "cloudflare:workers";

interface TableNameRow {
  name: string;
}

// `roles` / `role_permissions` are system reference data —
// built-in roles "ship with the portal" and are seeded once by migration
// consolidated migration 0035, not per-test business data (unlike e.g. `working_groups`, which
// tests already re-seed themselves when they need it). Wiping them on every
// resetDb() would break the FK from `user_roles.role_id` for any test that
// grants a built-in role (e.g. via POST .../events/:slug/permissions)
// without every such test re-inserting all nine built-in roles itself.
// `membership_settings` (consolidated migration 0035) is a singleton
// configuration row seeded once by the migration — the same class of
// system reference data as roles/role_permissions above, not per-test
// business data. Every membership-workflow code path (stage transitions,
// scheduled jobs, the admin settings endpoint) expects this row to always
// exist; wiping it on every resetDb() would require every such test to
// re-seed it itself.
// `mailing_lists` (consolidated migration 0035) is the same class of system
// reference data — its 9 rows are seeded once by the migration, and
// membership-onboarding.ts's approveApplication now reads the all_members/
// consultation rows at runtime (resolveAutoSyncListEmails) instead of the
// hardcoded constants it used to have. Wiping it on every resetDb() would
// silently stop every pre-existing approval-flow test from enqueueing
// Google Groups sync for pkic@/consultation@, the same failure mode
// membership_settings' exclusion already guards against.
// `membership_categories` (consolidated migration 0035) is the same class of system
// reference data too — its 15 rows (A-G/H1-H8) are seeded once by the
// migration, and member_category_assignments.category_code/
// member_applications.membership_category both carry a FOREIGN KEY into
// it (members.member_type no longer does — it's a plain
// 'individual'/'organization' discriminator, migration 0000's original
// meaning; category lives solely in member_category_assignments as of
// consolidated migration 0035). Wiping membership_categories on every resetDb() would
// fail every test's first insert of a categorized application/aggregate
// with a FK constraint error.
// `sponsorship_tier_catalog` and `sponsorship_tier_config` are likewise
// migration-seeded reference/configuration rows. Public sponsor rendering and
// self-service checkout must see the same canonical tier vocabulary in every
// test unless a test explicitly updates it.
const EXCLUDED_TABLES = new Set([
  "d1_migrations",
  "roles",
  "role_permissions",
  "membership_settings",
  "mailing_lists",
  "membership_categories",
  "group_types",
  "groups",
  "group_membership_category_rules",
  "event_profiles",
  "sponsorship_tier_catalog",
  "sponsorship_tier_config",
]);

const SEEDED_GROUP_IDS = [
  "20000000-0000-4000-8000-000000000001",
  "20000000-0000-4000-8000-000000000002",
  "20000000-0000-4000-8000-000000000003",
  "20000000-0000-4000-8000-000000000004",
  "20000000-0000-4000-8000-000000000005",
  "20000000-0000-4000-8000-000000000006",
  "20000000-0000-4000-8000-000000000007",
  "20000000-0000-4000-8000-000000000008",
] as const;

const SEEDED_MAILING_LIST_IDS = [
  "30000000-0000-4000-8000-000000000001",
  "30000000-0000-4000-8000-000000000002",
  "30000000-0000-4000-8000-000000000003",
  "30000000-0000-4000-8000-000000000004",
  "30000000-0000-4000-8000-000000000005",
  "30000000-0000-4000-8000-000000000006",
  "30000000-0000-4000-8000-000000000007",
  "30000000-0000-4000-8000-000000000008",
  "30000000-0000-4000-8000-000000000009",
] as const;

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

/** Test isolation may delete history, while production code remains unable to do so. */
async function suspendHistoryDeleteTrigger(): Promise<string | null> {
  const trigger = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_group_memberships_prevent_delete'",
  ).first<{ sql: string }>();
  if (!trigger?.sql) return null;
  await env.DB.prepare("DROP TRIGGER trg_group_memberships_prevent_delete").run();
  return trigger.sql;
}

async function restoreHistoryDeleteTrigger(sql: string | null): Promise<void> {
  if (!sql) return;
  // D1 exec() splits on the semicolon inside the trigger body. A prepared
  // schema statement preserves the complete CREATE TRIGGER statement.
  await env.DB.prepare(sql).run();
}

async function suspendMailingListDeleteTrigger(): Promise<string | null> {
  const trigger = await env.DB.prepare(
    "SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'trg_mailing_lists_prevent_delete'",
  ).first<{ sql: string }>();
  if (!trigger?.sql) return null;
  await env.DB.prepare("DROP TRIGGER trg_mailing_lists_prevent_delete").run();
  return trigger.sql;
}

async function restoreMailingListDeleteTrigger(sql: string | null): Promise<void> {
  if (!sql) return;
  await env.DB.prepare(sql).run();
}

/** Preserve migration-owned list configuration while removing test-created lists. */
async function clearTestMailingLists(): Promise<void> {
  await env.DB.prepare(`DELETE FROM mailing_lists WHERE id NOT IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(SEEDED_MAILING_LIST_IDS))
    .run();
}

/** Preserve migration-owned group configuration while removing test-created groups. */
async function clearTestGroups(): Promise<void> {
  const seedIdsJson = JSON.stringify(SEEDED_GROUP_IDS);
  await env.DB.batch([
    env.DB.prepare(
      `DELETE FROM group_membership_category_rules
          WHERE group_id NOT IN (SELECT value FROM json_each(?))`,
    ).bind(seedIdsJson),
    env.DB.prepare(`DELETE FROM groups WHERE id NOT IN (SELECT value FROM json_each(?))`).bind(seedIdsJson),
  ]);
}

/**
 * Clears all domain data from the test database while preserving the schema
 * and the D1 migration tracking table.  Call inside `beforeEach` in test files
 * that create multiple independent DB scenarios.
 */
export async function resetDb(): Promise<void> {
  const historyDeleteTriggerSql = await suspendHistoryDeleteTrigger();
  const mailingListDeleteTriggerSql = await suspendMailingListDeleteTrigger();
  try {
    await clearMembershipSettingsActorReference();
    const tableNames = await listResettableTables();
    await clearTablesWithRetry(tableNames);
    await clearTestMailingLists();
    await clearTestGroups();
  } finally {
    await restoreMailingListDeleteTrigger(mailingListDeleteTriggerSql);
    await restoreHistoryDeleteTrigger(historyDeleteTriggerSql);
  }
}
