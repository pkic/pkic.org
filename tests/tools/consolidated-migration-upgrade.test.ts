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
    VALUES
      ('org-1', 'Acme Corp', 'acme corp', '2025-01-01', '2025-01-01'),
      ('org-2', 'Pending Corp', 'pending corp', '2025-01-01', '2025-01-01');

    INSERT INTO users (id, email, normalized_email, first_name, role, created_at, updated_at)
    VALUES
      ('admin-1', 'admin@example.test', 'admin@example.test', 'Admin', 'admin', '2025-01-01', '2025-01-01'),
      ('organizer-1', 'organizer@example.test', 'organizer@example.test', 'Organizer', 'user', '2025-01-01', '2025-01-01');

    INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
    VALUES ('member-1', 'organization', 'org-1', 'active', '2025-01-01', '2025-01-01');

    INSERT INTO session_proposals
      (id, event_id, proposer_user_id, status, proposal_type, title, abstract,
       manage_link_secret, submitted_at, updated_at)
    VALUES
      ('proposal-1', 'event-1', 'organizer-1', 'accepted', 'talk', 'Existing proposal',
       'An existing proposal decision that must survive the consolidated migration.',
       'proposal-secret', '2025-01-01', '2025-01-02');

    INSERT INTO proposal_reviews
      (id, proposal_id, reviewer_user_id, recommendation, score, created_at, updated_at)
    VALUES ('review-1', 'proposal-1', 'admin-1', 'accept', 9, '2025-01-01', '2025-01-01');

    INSERT INTO proposal_decisions
      (id, proposal_id, decided_by_user_id, final_status, decision_note,
       min_reviews_required, review_count, decided_at)
    VALUES
      ('decision-1', 'proposal-1', 'admin-1', 'accepted', 'Accepted before upgrade', 1, 1, '2025-01-02');

    INSERT INTO event_permissions
      (id, event_id, user_email, user_id, permission, granted_by_id, created_at)
    VALUES
      ('permission-1', 'event-1', 'organizer@example.test', 'organizer-1', 'organizer', 'admin-1', '2025-01-02'),
      ('permission-2', 'event-1', 'preprovisioned@example.test', NULL, 'program_committee', 'admin-1', '2025-01-02'),
      ('permission-3', 'event-1', 'api-key-grantee@example.test', NULL, 'moderator', 'api-key', '2025-01-02'),
      ('permission-4', 'event-1', 'unknown-grantor@example.test', NULL, 'volunteer', 'legacy-missing-admin', '2025-01-02');

    INSERT INTO sponsors
      (id, organization_id, sponsorship_level, status, data_json, created_at, updated_at)
    VALUES
      ('sponsor-1', 'org-1', 'Gold', 'active', '{"legacyCompanyField":"kept"}', '2025-01-03', '2025-01-03'),
      ('sponsor-2', 'org-2', 'Silver', 'pending', '{"pendingLead":"kept"}', '2025-01-03', '2025-01-03');

    INSERT INTO sponsor_events
      (id, sponsor_id, event_id, sponsorship_level, sponsorship_subject, status, data_json, created_at, updated_at)
    VALUES
      ('sponsor-event-1', 'sponsor-1', 'event-1', 'Platinum', 'Upgrade test', 'active',
       '{"legacyEventField":"kept"}', '2025-01-04', '2025-01-04'),
      ('sponsor-event-1-alt', 'sponsor-1', 'event-1', 'Gold', 'Second legacy tier', 'active',
       '{"secondLegacyEventField":"kept"}', '2025-01-05', '2025-01-05'),
      ('sponsor-event-2', 'sponsor-2', 'event-1', 'Silver', 'Pending upgrade test', 'pending',
       '{"pendingEventField":"kept"}', '2025-01-04', '2025-01-04');

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
    expect(
      db
        .prepare(
          `SELECT u.normalized_email, ur.role_id
             FROM user_roles ur JOIN users u ON u.id = ur.user_id
            WHERE u.normalized_email = 'preprovisioned@example.test'`,
        )
        .all(),
    ).toEqual([{ normalized_email: "preprovisioned@example.test", role_id: "role-program_committee" }]);
    expect(
      db
        .prepare(
          `SELECT u.normalized_email, ur.granted_by_user_id
             FROM user_roles ur JOIN users u ON u.id = ur.user_id
            WHERE u.normalized_email IN (
              'organizer@example.test',
              'api-key-grantee@example.test',
              'unknown-grantor@example.test'
            )
            ORDER BY u.normalized_email`,
        )
        .all(),
    ).toEqual([
      { normalized_email: "api-key-grantee@example.test", granted_by_user_id: null },
      { normalized_email: "organizer@example.test", granted_by_user_id: "admin-1" },
      { normalized_email: "unknown-grantor@example.test", granted_by_user_id: null },
    ]);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name IN (
             'idx_session_proposals_event_live_submitted',
             'idx_session_proposals_event_deleted_submitted'
           ) ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "idx_session_proposals_event_deleted_submitted" },
      { name: "idx_session_proposals_event_live_submitted" },
    ]);
    expect(db.prepare("SELECT id, organization_id FROM members").all()).toEqual([
      { id: "member-1", organization_id: "org-1" },
    ]);
    expect(db.prepare("SELECT id, normalized_name, sponsor_tier FROM organizations ORDER BY id").all()).toEqual([
      { id: "org-1", normalized_name: "acme corp", sponsor_tier: "Gold" },
      { id: "org-2", normalized_name: "pending corp", sponsor_tier: null },
    ]);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'table' AND name = 'organization_content_review_notification_intents'`,
        )
        .all(),
    ).toEqual([{ name: "organization_content_review_notification_intents" }]);
    expect(
      db
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type = 'index' AND name IN (
             'idx_org_content_review_notification_intents_pending',
             'uq_org_content_review_notification_intents_outbox'
           ) ORDER BY name`,
        )
        .all(),
    ).toEqual([
      { name: "idx_org_content_review_notification_intents_pending" },
      { name: "uq_org_content_review_notification_intents_outbox" },
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

    const sponsorshipRows = db
      .prepare(
        `SELECT sponsor_type, organization_id, tier, pipeline_stage, notes
         FROM sponsorships
         ORDER BY sponsor_type, organization_id, tier`,
      )
      .all() as Array<{
      sponsor_type: string;
      organization_id: string;
      tier: string;
      pipeline_stage: string;
      notes: string;
    }>;
    expect(sponsorshipRows.map(({ notes: _notes, ...row }) => row)).toEqual([
      { sponsor_type: "consortium", organization_id: "org-1", tier: "Gold", pipeline_stage: "active" },
      { sponsor_type: "consortium", organization_id: "org-2", tier: "Silver", pipeline_stage: "new_inquiry" },
      { sponsor_type: "event", organization_id: "org-1", tier: "Gold", pipeline_stage: "active" },
      { sponsor_type: "event", organization_id: "org-1", tier: "Platinum", pipeline_stage: "active" },
      { sponsor_type: "event", organization_id: "org-2", tier: "Silver", pipeline_stage: "payment_pending" },
    ]);
    expect(sponsorshipRows.map((row) => JSON.parse(row.notes))).toEqual([
      { legacySponsorData: { legacyCompanyField: "kept" } },
      { legacySponsorData: { pendingLead: "kept" } },
      {
        legacySponsorData: { legacyCompanyField: "kept" },
        legacySponsorshipSubject: "Second legacy tier",
        legacyEventData: { secondLegacyEventField: "kept" },
      },
      {
        legacySponsorData: { legacyCompanyField: "kept" },
        legacySponsorshipSubject: "Upgrade test",
        legacyEventData: { legacyEventField: "kept" },
      },
      {
        legacySponsorData: { pendingLead: "kept" },
        legacySponsorshipSubject: "Pending upgrade test",
        legacyEventData: { pendingEventField: "kept" },
      },
    ]);
    expect(
      db
        .prepare("SELECT id, organization_id, sponsorship_level, status FROM sponsors ORDER BY id")
        .all(),
    ).toEqual([
      { id: "sponsor-1", organization_id: "org-1", sponsorship_level: "Gold", status: "active" },
      { id: "sponsor-2", organization_id: "org-2", sponsorship_level: "Silver", status: "pending" },
    ]);
    expect(
      db
        .prepare(
          "SELECT id, sponsor_id, event_id, sponsorship_level, status FROM sponsor_events ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "sponsor-event-1",
        sponsor_id: "sponsor-1",
        event_id: "event-1",
        sponsorship_level: "Platinum",
        status: "active",
      },
      {
        id: "sponsor-event-1-alt",
        sponsor_id: "sponsor-1",
        event_id: "event-1",
        sponsorship_level: "Gold",
        status: "active",
      },
      {
        id: "sponsor-event-2",
        sponsor_id: "sponsor-2",
        event_id: "event-1",
        sponsorship_level: "Silver",
        status: "pending",
      },
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
        .prepare("PRAGMA table_info(application_documents)")
        .all()
        .map((column: any) => column.name),
    ).toEqual(expect.arrayContaining(["content_sha256", "idempotency_key_hash"]));
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_application_documents_app', 'uq_application_documents_idempotency') ORDER BY name",
        )
        .all(),
    ).toEqual([{ name: "idx_application_documents_app" }, { name: "uq_application_documents_idempotency" }]);
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name IN ('apply_application_document_insert_guard', 'validate_application_document_insert_guard') ORDER BY name",
        )
        .all(),
    ).toEqual([
      { name: "apply_application_document_insert_guard" },
      { name: "validate_application_document_insert_guard" },
    ]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'badge_render_jobs'").get(),
    ).toEqual({ name: "badge_render_jobs" });
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
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uq_user_roles_active_user_role_context'",
        )
        .all(),
    ).toEqual([{ name: "uq_user_roles_active_user_role_context" }]);
    expect(
      db
        .prepare("PRAGMA table_info(user_roles)")
        .all()
        .map((column: any) => ({ name: column.name, notnull: column.notnull }))
        .filter((column) => column.name === "user_id" || column.name === "user_email"),
    ).toEqual([{ name: "user_id", notnull: 1 }]);
    expect(db.prepare("SELECT review_round FROM session_proposals WHERE id = 'proposal-1'").get()).toEqual({
      review_round: 1,
    });
    expect(db.prepare("SELECT review_round FROM proposal_reviews WHERE id = 'review-1'").get()).toEqual({
      review_round: 1,
    });
    expect(db.prepare("SELECT review_round FROM proposal_decisions WHERE id = 'decision-1'").get()).toEqual({
      review_round: 1,
    });
    expect(
      db
        .prepare(
          "SELECT id, proposal_id, review_round, final_status FROM proposal_decision_history WHERE proposal_id = 'proposal-1'",
        )
        .get(),
    ).toEqual({ id: "decision-1", proposal_id: "proposal-1", review_round: 1, final_status: "accepted" });
    expect(
      db
        .prepare(
          "SELECT decision_id, proposal_id, review_round, review_id, score FROM proposal_review_history WHERE proposal_id = 'proposal-1'",
        )
        .get(),
    ).toEqual({
      decision_id: "decision-1",
      proposal_id: "proposal-1",
      review_round: 1,
      review_id: "review-1",
      score: 9,
    });
  });
});
