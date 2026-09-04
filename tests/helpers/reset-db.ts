import { env } from "cloudflare:workers";

interface TableNameRow {
  name: string;
}

let cachedResettableTables: string[] | null = null;
let cachedDeleteOrder: string[] | null = null;
let baselinesInitialized = false;

// `roles` / `role_permissions` are system reference data —
// built-in roles "ship with the portal" and are seeded once by migration
// consolidated migration 0035, not per-test business data (unlike ordinary
// groups that a test creates for its own scenario). Wiping them on every
// resetDb() would break the FK from `user_roles.role_id` for any test that
// grants a built-in role (e.g. via POST .../events/:slug/permissions)
// without every such test re-inserting all nine built-in roles itself.
// `membership_settings` (consolidated migration 0035) is a singleton
// configuration row seeded once by the migration — the same class of
// system reference data as roles/role_permissions above, not per-test
// business data. Every membership-workflow code path (stage transitions,
// scheduled jobs, the system settings endpoint) expects this row to always
// exist; wiping it on every resetDb() would require every such test to
// re-seed it itself.
// `standing_levels` (consolidated migration 0035) is the same class of system
// reference data: the five bands a points total resolves through are seeded
// once by the migration and are configuration the consortium owns, not
// per-test business data. Wiping them leaves an empty ladder, which
// `standingFor` deliberately resolves to an unranked position — so every
// standing read would quietly report level 0 instead of failing loudly.
// `mailing_lists` (consolidated migration 0035) is the same class of system
// reference data — its 9 rows are seeded once by the migration, and
// membership-onboarding.ts's approveApplication now reads the all_members/
// consultation rows at runtime (resolveAutoSyncListEmails) instead of the
// hardcoded constants it used to have. Wiping it on every resetDb() would
// silently stop every pre-existing approval-flow test from enqueueing
// Google Groups sync for pkic@/consultation@, the same failure mode
// membership_settings' exclusion already guards against.
// `membership_categories` (consolidated migration 0035) is the same class of system
// reference data too — its 15 category codes (A-G/H1-H8) are seeded once by the
// migration, and member_category_assignments.category_code/
// member_applications.membership_category both carry a FOREIGN KEY into
// it (members.member_type no longer does — it's a plain
// 'individual'/'organization' discriminator, migration 0000's original
// meaning; category lives solely in member_category_assignments as of
// consolidated migration 0035). Labels, ordering, and voting policy remain
// runtime-editable; resetDb() restores their migration baseline so one test
// cannot leak configuration into another. Wiping membership_categories on
// every resetDb() would
// fail every test's first insert of a categorized application/aggregate
// with a FK constraint error.
// `sponsorship_tier_catalog` and `sponsorship_tier_config` are likewise
// migration-seeded reference/configuration rows. Public sponsor rendering and
// self-service checkout must see the same canonical tier vocabulary in every
// test unless a test explicitly updates it.
// `scheduled_jobs` (consolidated migration 0035) is system reference data of
// the same class: one row per recurring job, seeded once by the migration and
// expected to exist by the dispatcher. Wiping it would leave every scheduled
// pass with nothing to select, silently turning the scheduler into a no-op for
// any test that runs after a reset.
const EXCLUDED_TABLES = new Set([
  "d1_migrations",
  "scheduled_jobs",
  "roles",
  "role_permissions",
  "membership_settings",
  "mailing_lists",
  "membership_categories",
  "group_types",
  "standing_levels",
  "groups",
  "group_membership_category_rules",
  "event_profiles",
  "sponsorship_tier_catalog",
  "sponsorship_tier_config",
  "_test_membership_category_baseline",
  "_test_membership_settings_baseline",
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
  "20000000-0000-4000-8000-000000000009",
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
  if (cachedResettableTables) return cachedResettableTables;

  const { results } = await env.DB.prepare(
    `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`,
  ).all<TableNameRow>();

  cachedResettableTables = results
    .map((row: TableNameRow) => row.name)
    .filter((name: string) => !name.startsWith("_cf_"))
    .filter((name: string) => !EXCLUDED_TABLES.has(name));
  return cachedResettableTables;
}

async function clearTablesWithRetry(tableNames: string[]): Promise<void> {
  if (cachedDeleteOrder) {
    try {
      await env.DB.batch(cachedDeleteOrder.map((tableName) => env.DB.prepare(`DELETE FROM "${tableName}"`)));
      return;
    } catch {
      // A later test may populate an FK edge that earlier resets did not.
      // The batch is atomic, so relearn a safe order without partial cleanup.
      cachedDeleteOrder = null;
    }
  }

  const pending = new Set(tableNames);
  const deleteOrder: string[] = [];

  // Re-try deletes so FK parents are attempted after children are cleared.
  while (pending.size > 0) {
    let deletedInPass = 0;

    for (const tableName of Array.from(pending)) {
      try {
        await env.DB.prepare(`DELETE FROM "${tableName}"`).run();
        pending.delete(tableName);
        deleteOrder.push(tableName);
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

  cachedDeleteOrder = deleteOrder;
}

/**
 * Capture the migration's actual category seed once for this test database.
 * Keeping this fixture in D1 prevents resetDb() from duplicating migration
 * labels, ordering, or voting defaults in TypeScript.
 */
async function ensureMembershipCategoryBaseline(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS _test_membership_category_baseline (
         code TEXT NOT NULL PRIMARY KEY,
         label TEXT NOT NULL,
         description TEXT,
         display_order INTEGER NOT NULL,
         is_voting INTEGER NOT NULL
       )`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO _test_membership_category_baseline
         (code, label, description, display_order, is_voting)
       SELECT code, label, description, display_order, is_voting
         FROM membership_categories`,
    ),
  ]);
}

/** Capture the migration-owned singleton rather than mirroring its defaults in TypeScript. */
async function ensureMembershipSettingsBaseline(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS _test_membership_settings_baseline (
         id TEXT NOT NULL PRIMARY KEY,
         consultation_window_days INTEGER NOT NULL,
         ec_review_window_days INTEGER NOT NULL,
         on_hold_response_deadline_days INTEGER NOT NULL,
         consultation_email_recipients TEXT NOT NULL,
         ec_email_recipients TEXT NOT NULL,
         cc_applicant_emails TEXT NOT NULL,
         auto_reminder_on_holds INTEGER NOT NULL,
         revision INTEGER NOT NULL,
         updated_at TEXT NOT NULL,
         updated_by_user_id TEXT
       )`,
    ),
    env.DB.prepare(
      `INSERT OR IGNORE INTO _test_membership_settings_baseline
         (id, consultation_window_days, ec_review_window_days, on_hold_response_deadline_days,
          consultation_email_recipients, ec_email_recipients, cc_applicant_emails,
          auto_reminder_on_holds, revision, updated_at, updated_by_user_id)
       SELECT id, consultation_window_days, ec_review_window_days, on_hold_response_deadline_days,
              consultation_email_recipients, ec_email_recipients, cc_applicant_emails,
              auto_reminder_on_holds, revision, updated_at, updated_by_user_id
         FROM membership_settings`,
    ),
  ]);
}

/** Restore mutable reference/configuration rows before clearing their actors and consumers. */
async function resetMembershipConfiguration(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE membership_settings
          SET consultation_window_days = (SELECT consultation_window_days FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              ec_review_window_days = (SELECT ec_review_window_days FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              on_hold_response_deadline_days = (SELECT on_hold_response_deadline_days FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              consultation_email_recipients = (SELECT consultation_email_recipients FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              ec_email_recipients = (SELECT ec_email_recipients FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              cc_applicant_emails = (SELECT cc_applicant_emails FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              auto_reminder_on_holds = (SELECT auto_reminder_on_holds FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              revision = (SELECT revision FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              updated_at = (SELECT updated_at FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id),
              updated_by_user_id = (SELECT updated_by_user_id FROM _test_membership_settings_baseline baseline WHERE baseline.id = membership_settings.id)
        WHERE id IN (SELECT id FROM _test_membership_settings_baseline)`,
    ),
    env.DB.prepare(
      `UPDATE membership_categories
          SET label = (SELECT label FROM _test_membership_category_baseline baseline WHERE baseline.code = membership_categories.code),
              description = (SELECT description FROM _test_membership_category_baseline baseline WHERE baseline.code = membership_categories.code),
              display_order = (SELECT display_order FROM _test_membership_category_baseline baseline WHERE baseline.code = membership_categories.code),
              is_voting = (SELECT is_voting FROM _test_membership_category_baseline baseline WHERE baseline.code = membership_categories.code),
              revision = 0,
              updated_at = '1970-01-01T00:00:00.000Z'
        WHERE code IN (SELECT code FROM _test_membership_category_baseline)`,
    ),
  ]);
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
    if (!baselinesInitialized) {
      await ensureMembershipCategoryBaseline();
      await ensureMembershipSettingsBaseline();
      baselinesInitialized = true;
    }
    await resetMembershipConfiguration();
    const tableNames = await listResettableTables();
    await clearTablesWithRetry(tableNames);
    await clearTestMailingLists();
    await clearTestGroups();
  } finally {
    await restoreMailingListDeleteTrigger(mailingListDeleteTriggerSql);
    await restoreHistoryDeleteTrigger(historyDeleteTriggerSql);
  }
}
