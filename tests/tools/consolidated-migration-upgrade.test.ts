import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..", "..");
const MIGRATIONS_DIR = path.join(ROOT, "migrations");
const CONSOLIDATED_MIGRATION = "0035_membership_portal_governance.sql";

function migrationNumber(fileName: string): number {
  return Number(fileName.slice(0, 4));
}

function applyMigrationsBefore0035(db: DatabaseSync): void {
  const migrationFiles = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName) && migrationNumber(fileName) < 35)
    .sort();
  for (const fileName of migrationFiles) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8"));
  }
}

function seedRepresentativePre0035State(db: DatabaseSync): void {
  db.exec(`
    INSERT INTO events (id, slug, name, timezone, created_at, updated_at)
    VALUES ('event-1', 'upgrade-test', 'Upgrade test', 'UTC', '2025-01-01', '2025-01-01');

    INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
    VALUES ('org-1', 'Acme Corp', 'acme corp', '2025-01-01', '2025-01-01');

    INSERT INTO users (id, email, normalized_email, first_name, role, created_at, updated_at)
    VALUES
      ('admin-1', 'admin@example.test', 'admin@example.test', 'Admin', 'admin', '2025-01-01', '2025-01-01'),
      ('organizer-1', 'organizer@example.test', 'organizer@example.test', 'Organizer', 'user', '2025-01-01', '2025-01-01');

    INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
    VALUES ('member-1', 'organization', 'org-1', 'active', '2025-01-01', '2025-01-01');

    INSERT INTO event_permissions
      (id, event_id, user_email, user_id, permission, granted_by_id, created_at)
    VALUES
      ('permission-1', 'event-1', 'organizer@example.test', 'organizer-1', 'organizer', 'admin-1', '2025-01-02');

    INSERT INTO sponsors
      (id, organization_id, sponsorship_level, status, created_at, updated_at)
    VALUES ('sponsor-1', 'org-1', 'Gold', 'active', '2025-01-03', '2025-01-03');

    INSERT INTO sponsor_events
      (id, sponsor_id, event_id, sponsorship_level, sponsorship_subject, status, created_at, updated_at)
    VALUES ('sponsor-event-1', 'sponsor-1', 'event-1', 'Platinum', 'Upgrade test', 'active', '2025-01-04', '2025-01-04');

    INSERT INTO invites
      (id, event_id, invitee_email, invite_type, link_secret, status, created_at)
    VALUES
      ('invite-old', 'event-1', 'invitee@example.test', 'attendee', 'token-old', 'sent', '2025-01-01'),
      ('invite-new', 'event-1', 'invitee@example.test', 'attendee', 'token-new', 'sent', '2025-01-02');

    INSERT INTO donations
      (id, checkout_session_id, name, email, currency, gross_amount, status, created_at)
    VALUES ('donation-1', 'cs_upgrade', 'Donor', 'donor@example.test', 'usd', 5000, 'completed', '2025-01-01');

    INSERT INTO donation_promoters (code, donation_id, name, clicks, created_at)
    VALUES
      ('OLDCODE1', 'donation-1', 'Original', 7, '2025-01-01'),
      ('NEWCODE1', 'donation-1', 'Alias', 3, '2025-01-02');
  `);
}

describe("consolidated pending migration upgrade", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("upgrades realistic pre-0035 data without rebuilding members or organizations or losing backfills", () => {
    db = new DatabaseSync(":memory:");
    applyMigrationsBefore0035(db);
    seedRepresentativePre0035State(db);

    const migrationSql = fs.readFileSync(path.join(MIGRATIONS_DIR, CONSOLIDATED_MIGRATION), "utf8");
    expect(migrationSql).not.toMatch(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:members|organizations)\b/i);
    expect(migrationSql).not.toMatch(/ALTER\s+TABLE\s+(?:members|organizations)\s+RENAME\b/i);
    db.exec(migrationSql);

    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(db.prepare("SELECT id, organization_id FROM members").all()).toEqual([
      { id: "member-1", organization_id: "org-1" },
    ]);
    expect(db.prepare("SELECT id, normalized_name, sponsor_tier FROM organizations").all()).toEqual([
      { id: "org-1", normalized_name: "acme corp", sponsor_tier: "Gold" },
    ]);

    const roles = db
      .prepare("SELECT user_id, role_id, context_type, context_id FROM user_roles ORDER BY role_id")
      .all();
    expect(roles).toEqual(
      expect.arrayContaining([
        { user_id: "admin-1", role_id: "role-admin", context_type: null, context_id: null },
        {
          user_id: "organizer-1",
          role_id: "role-event_organizer",
          context_type: "event",
          context_id: "event-1",
        },
      ]),
    );
    expect(
      db
        .prepare("SELECT permission FROM role_permissions WHERE role_id = 'role-event_organizer' ORDER BY permission")
        .all(),
    ).toEqual(
      expect.arrayContaining([
        { permission: "proposals:read" },
        { permission: "proposals:score" },
        { permission: "proposals:manage" },
      ]),
    );
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_permissions'").get()).toBe(
      undefined,
    );

    expect(
      db.prepare("SELECT sponsor_type, tier, pipeline_stage FROM sponsorships ORDER BY sponsor_type").all(),
    ).toEqual([
      { sponsor_type: "consortium", tier: "Gold", pipeline_stage: "active" },
      { sponsor_type: "event", tier: "Platinum", pipeline_stage: "active" },
    ]);
    expect(db.prepare("SELECT id, status FROM invites ORDER BY id").all()).toEqual([
      { id: "invite-new", status: "revoked" },
      { id: "invite-old", status: "sent" },
    ]);
    expect(db.prepare("SELECT code, donation_id, clicks FROM donation_promoters ORDER BY code").all()).toEqual([
      { code: "NEWCODE1", donation_id: null, clicks: 3 },
      { code: "OLDCODE1", donation_id: "donation-1", clicks: 7 },
    ]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_registration_attendance_history_registration_changed'",
        )
        .get(),
    ).toEqual({ name: "idx_registration_attendance_history_registration_changed" });
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'storage_deletion_outbox'").get(),
    ).toEqual({ name: "storage_deletion_outbox" });
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_consent_acceptances_registration_term'",
        )
        .get(),
    ).toEqual({ name: "idx_consent_acceptances_registration_term" });
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_registrations_event_status_created'",
        )
        .get(),
    ).toEqual({ name: "idx_registrations_event_status_created" });
    expect(
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'registration_badge_role_overrides'")
        .get(),
    ).toEqual({ name: "registration_badge_role_overrides" });
    expect(
      db
        .prepare("PRAGMA table_info(registration_badge_role_overrides)")
        .all()
        .map((column: any) => column.name),
    ).toEqual(["registration_id", "role", "set_by_user_id", "created_at", "updated_at"]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('uq_user_roles_active_email_role_context', 'uq_user_roles_active_user_role_context') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "uq_user_roles_active_email_role_context" },
      { name: "uq_user_roles_active_user_role_context" },
    ]);
  });
});
