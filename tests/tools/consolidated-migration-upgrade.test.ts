import { promotionFormatSchema } from "../../assets/shared/schemas/event-promotion-kit";
import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { afterEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { DEFAULT_LAYOUT_HTML, DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import { renderEmail } from "../../functions/_lib/email/render";

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
    INSERT INTO events (id, slug, name, timezone, starts_at, ends_at, created_at, updated_at)
    VALUES
      (
        'event-1', 'upgrade-test', 'Upgrade test', 'UTC',
        '2025-02-01 09:00:00+00:00', '2025-02-01T17:00:00Z',
        '2025-01-01', '2025-01-01'
      ),
      (
        'event-future', 'future-upgrade-test', 'Future upgrade test', 'UTC',
        '2099-02-01 09:00:00+00:00', '2099-02-01T17:00:00Z',
        '2025-01-01', '2025-01-01'
      ),
      (
        'event-malformed', 'malformed-upgrade-test', 'Malformed upgrade test', 'UTC',
        'not-a-date', 'also-not-a-date',
        '2025-01-01', '2025-01-01'
      ),
      (
        'event-reversed', 'reversed-upgrade-test', 'Reversed upgrade test', 'UTC',
        '2099-03-02T09:00:00Z', '2099-03-01T17:00:00Z',
        '2025-01-01', '2025-01-01'
      );

    INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
    VALUES
      ('org-1', 'Acme Corp', 'acme corp', '2025-01-01', '2025-01-01'),
      ('org-2', 'Pending Corp', 'pending corp', '2025-01-01', '2025-01-01');

    INSERT INTO users (id, email, normalized_email, first_name, role, created_at, updated_at)
    VALUES
      ('admin-1', 'admin@example.test', 'admin@example.test', 'Admin', 'admin', '2025-01-01', '2025-01-01'),
      ('organizer-1', 'organizer@example.test', 'organizer@example.test', 'Organizer', 'user', '2025-01-01', '2025-01-01');

    INSERT INTO registrations
      (id, event_id, user_id, status, attendance_type, source_type,
       manage_link_secret, created_at, updated_at)
    VALUES
      ('registration-upgrade', 'event-1', 'organizer-1', 'registered', 'virtual', 'test',
       'manage-registration-upgrade', '2025-01-01', '2025-01-01');

    INSERT INTO calendar_rsvp_events
      (id, registration_id, ics_uid, attendee_email, response_status, provider,
       source_message_id, dedupe_key, received_at, created_at, updated_at)
    VALUES
      ('rsvp-json-key', 'registration-upgrade', 'registration-upgrade@example.test',
       'organizer@example.test', 'accepted', 'google', 'message-1',
       '["registration-upgrade","message-1"]', '2025-01-01', '2025-01-01', '2025-01-01'),
      ('rsvp-legacy-key', 'registration-upgrade', 'registration-upgrade@example.test',
       'organizer@example.test', 'accepted', 'microsoft', 'message-2',
       'legacy-non-json-key', '2025-01-02', '2025-01-02', '2025-01-02');

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

    INSERT INTO email_template_versions
      (id, template_key, version, body, status, created_at)
    VALUES
      ('template-active-old', 'duplicate_active_upgrade', 1, 'Old active body', 'active', '2025-01-01'),
      ('template-active-new', 'duplicate_active_upgrade', 2, 'New active body', 'active', '2025-01-02');

    INSERT INTO forms
      (id, key, scope_type, scope_ref, purpose, status, title, created_at, updated_at)
    VALUES
      ('form-upgrade', 'upgrade-survey', 'global', NULL, 'survey', 'active',
       'Upgrade survey', '2025-01-01', '2025-01-01');

    INSERT INTO form_fields
      (id, form_id, key, label, field_type, required, sort_order, created_at)
    VALUES
      ('field-upgrade', 'form-upgrade', 'old_key', 'Old label', 'text', 0, 10, '2025-01-01');

    INSERT INTO form_submissions
      (id, form_id, context_type, status, submitted_at)
    VALUES
      ('submission-upgrade', 'form-upgrade', 'survey', 'submitted', '2025-01-02');

    INSERT INTO form_submission_answers
      (id, submission_id, field_key, data_json, created_at)
    VALUES
      ('answer-mapped', 'submission-upgrade', 'old_key', '"Mapped"', '2025-01-02'),
      ('answer-unmapped', 'submission-upgrade', 'removed_legacy_key', '"Unmapped"', '2025-01-02');

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
      (id, event_id, invitee_email, invite_type, link_secret, status, expires_at, created_at)
    VALUES
      ('invite-old', 'event-1', 'invitee@example.test', 'attendee', 'token-old', 'sent', NULL, '2025-01-01'),
      ('invite-new', 'event-1', 'invitee@example.test', 'attendee', 'token-new', 'sent',
       '2025-02-02T09:00:00+00:00', '2025-01-02'),
      ('invite-early', 'event-1', 'early@example.test', 'attendee', 'token-early', 'sent',
       '2025-02-01T12:00:00Z', '2025-01-02'),
      ('invite-malformed', 'event-1', 'malformed@example.test', 'attendee', 'token-malformed', 'sent',
       'not-a-date', '2025-01-02'),
      ('invite-future-old', 'event-future', ' Duplicate@Example.Test ', 'attendee', 'token-future-old', 'sent',
       NULL, '2025-01-01'),
      ('invite-future-new', 'event-future', 'duplicate@example.test', 'attendee', 'token-future-new', 'sent',
       '2099-02-02T09:00:00+00:00', '2025-01-02'),
      ('invite-future-tie-a', 'event-future', 'tie@example.test', 'attendee', 'token-future-tie-a', 'sent',
       NULL, '2025-01-03'),
      ('invite-future-tie-z', 'event-future', 'tie@example.test', 'attendee', 'token-future-tie-z', 'sent',
       NULL, '2025-01-03'),
      ('invite-blank', 'event-future', '   ', 'attendee', 'token-blank', 'sent',
       NULL, '2025-01-02'),
      ('invite-invalid-missing-at', 'event-future', 'not-an-email', 'attendee', 'token-invalid-missing-at', 'sent',
       NULL, '2025-01-02'),
      ('invite-invalid-multiple-at', 'event-future', 'foo@@example.test', 'attendee', 'token-invalid-multiple-at', 'sent',
       NULL, '2025-01-02'),
      ('invite-invalid-missing-domain', 'event-future', 'foo@', 'attendee', 'token-invalid-missing-domain', 'sent',
       NULL, '2025-01-02'),
      ('invite-invalid-whitespace', 'event-future', 'bad address@example.test', 'attendee', 'token-invalid-whitespace', 'sent',
       NULL, '2025-01-02'),
      ('invite-created-order-old', 'event-future', 'created-order@example.test', 'attendee', 'token-created-order-old', 'sent',
       NULL, '2025-01-02T08:00:00.000Z'),
      ('invite-created-order-new', 'event-future', 'created-order@example.test', 'attendee', 'token-created-order-new', 'sent',
       NULL, '2025-01-02 09:00:00+00:00'),
      ('invite-created-malformed', 'event-future', 'created-validity@example.test', 'attendee', 'token-created-malformed', 'sent',
       NULL, 'not-a-date'),
      ('invite-created-canonical', 'event-future', 'created-validity@example.test', 'attendee', 'token-created-canonical', 'sent',
       NULL, '2025-01-02T09:00:00.000Z'),
      ('invite-bad-event', 'event-malformed', 'bad-event@example.test', 'attendee', 'token-bad-event', 'sent',
       NULL, '2025-01-02'),
      ('invite-reversed-event', 'event-reversed', 'reversed-event@example.test', 'attendee',
       'token-reversed-event', 'sent',
       NULL, '2025-01-02');

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

  it("upgrades realistic pre-0035 data without rebuilding members or organizations or losing backfills", async () => {
    db = new DatabaseSync(":memory:");
    applyMigrationsBefore0035(db);
    seedRepresentativePre0035State(db);

    const migrationSql = fs.readFileSync(path.join(MIGRATIONS_DIR, CONSOLIDATED_MIGRATION), "utf8");
    expect(migrationSql).not.toMatch(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:members|organizations)\b/i);
    expect(migrationSql).not.toMatch(/ALTER\s+TABLE\s+(?:members|organizations)\s+RENAME\b/i);
    db.exec(migrationSql);
    const reminder = db
      .prepare(
        "SELECT body FROM email_template_versions WHERE template_key = 'speaker_profile_reminder' AND status = 'active'",
      )
      .get();
    const reminderEmail = await renderEmail(
      String(reminder?.body),
      {
        proposalTitle: "Forms for organizations",
        eventName: "User conference",
        requiresConfirmation: true,
        profileUrl: "https://example.test/speaker",
      },
      DEFAULT_LAYOUT_HTML,
      "markdown",
      "https://example.test",
    );
    expect(reminderEmail.text).toContain("confirm or decline your participation");
    expect(reminderEmail.text).not.toContain("has been accepted");
    const userMagicLinkBaseline = DEFAULT_TEMPLATES.find((template) => template.key === "user_magic_link");
    expect(userMagicLinkBaseline).toBeDefined();

    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'refresh_tokens'").get(),
    ).toBeUndefined();
    expect(
      db
        .prepare(
          `SELECT version, status
             FROM email_template_versions
            WHERE template_key = 'duplicate_active_upgrade'
            ORDER BY version`,
        )
        .all(),
    ).toEqual([
      { version: 1, status: "archived" },
      { version: 2, status: "active" },
    ]);
    expect(
      db
        .prepare(
          `SELECT template_key, status, body
             FROM email_template_versions
            WHERE template_key IN ('admin_magic_link', 'user_magic_link')
            ORDER BY template_key`,
        )
        .all(),
    ).toEqual([
      {
        template_key: "admin_magic_link",
        status: "archived",
        body: expect.any(String),
      },
      {
        template_key: "user_magic_link",
        status: "active",
        body: userMagicLinkBaseline!.content.trimEnd(),
      },
    ]);
    expect(() =>
      db!.exec(
        `INSERT INTO email_template_versions
           (id, template_key, version, body, status, created_at)
         VALUES
           ('template-active-third', 'duplicate_active_upgrade', 3, 'Third active body', 'active', '2025-01-03')`,
      ),
    ).toThrow(/UNIQUE constraint failed/);
    expect(
      db
        .prepare(
          `SELECT name, type, "notnull" AS "notnull", dflt_value
             FROM pragma_table_info('groups') WHERE name = 'revision'`,
        )
        .get(),
    ).toEqual({ name: "revision", type: "INTEGER", notnull: 1, dflt_value: "0" });
    expect(
      db
        .prepare(
          `SELECT type, name FROM sqlite_master
            WHERE name IN (
              'event_resource_management_guards',
              'trg_event_resource_management_guard_validate',
              'trg_event_resource_management_guard_release'
            )
            ORDER BY type, name`,
        )
        .all(),
    ).toEqual([
      { type: "table", name: "event_resource_management_guards" },
      { type: "trigger", name: "trg_event_resource_management_guard_release" },
      { type: "trigger", name: "trg_event_resource_management_guard_validate" },
    ]);
    expect(
      db
        .prepare("PRAGMA foreign_key_list(event_resource_management_guards)")
        .all()
        .map((foreignKey: any) => foreignKey.table)
        .sort(),
    ).toEqual(["events", "groups", "users"]);
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
    expect(
      db
        .prepare(
          "SELECT id, form_placement_id, registration_group_id FROM registrations WHERE id = 'registration-upgrade'",
        )
        .get(),
    ).toEqual({ id: "registration-upgrade", form_placement_id: null, registration_group_id: null });
    expect(
      db
        .prepare("PRAGMA foreign_key_list(registrations)")
        .all()
        .some(
          (foreignKey) =>
            foreignKey.table === "groups" && foreignKey.from === "registration_group_id" && foreignKey.to === "id",
        ),
    ).toBe(true);
    expect(db.prepare("SELECT id, form_placement_id FROM session_proposals WHERE id = 'proposal-1'").get()).toEqual({
      id: "proposal-1",
      form_placement_id: null,
    });
    expect(
      db
        .prepare(
          `SELECT id, field_id, field_key
           FROM form_submission_answers
           WHERE submission_id = 'submission-upgrade'
           ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "answer-mapped", field_id: "field-upgrade", field_key: "old_key" },
      { id: "answer-unmapped", field_id: null, field_key: "removed_legacy_key" },
    ]);
    db.prepare("UPDATE form_fields SET key = 'new_key' WHERE id = 'field-upgrade'").run();
    expect(
      db
        .prepare(
          `SELECT a.id, COALESCE(ff.key, a.field_key) AS rendered_key
           FROM form_submission_answers a
           LEFT JOIN form_fields ff ON ff.id = a.field_id
           WHERE a.submission_id = 'submission-upgrade'
           ORDER BY a.id`,
        )
        .all(),
    ).toEqual([
      { id: "answer-mapped", rendered_key: "new_key" },
      { id: "answer-unmapped", rendered_key: "removed_legacy_key" },
    ]);
    expect(db.prepare("SELECT id, dedupe_key FROM calendar_rsvp_events ORDER BY id").all()).toEqual([
      { id: "rsvp-json-key", dedupe_key: '["google","registration-upgrade","message-1"]' },
      { id: "rsvp-legacy-key", dedupe_key: "legacy-non-json-key" },
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
        { permission: "proposals:edit_accepted_abstract" },
        { permission: "proposals:cancel_accepted" },
      ]),
    );
    expect(
      db
        .prepare(
          `SELECT role_id
             FROM role_permissions
            WHERE permission = 'proposals:edit_accepted_abstract'
            ORDER BY role_id`,
        )
        .all(),
    ).toEqual([{ role_id: "role-admin" }, { role_id: "role-event_organizer" }, { role_id: "role-program_committee" }]);
    expect(
      db
        .prepare("SELECT role_id FROM role_permissions WHERE permission = 'proposals:cancel_accepted' ORDER BY role_id")
        .all(),
    ).toEqual([{ role_id: "role-admin" }, { role_id: "role-event_organizer" }, { role_id: "role-program_committee" }]);
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
    expect(db.prepare("SELECT id, organization_id, sponsorship_level, status FROM sponsors ORDER BY id").all()).toEqual(
      [
        { id: "sponsor-1", organization_id: "org-1", sponsorship_level: "Gold", status: "active" },
        { id: "sponsor-2", organization_id: "org-2", sponsorship_level: "Silver", status: "pending" },
      ],
    );
    expect(
      db.prepare("SELECT id, sponsor_id, event_id, sponsorship_level, status FROM sponsor_events ORDER BY id").all(),
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
    expect(
      db
        .prepare(
          `SELECT id, starts_at, ends_at
             FROM events
            WHERE id IN ('event-1', 'event-future', 'event-malformed', 'event-reversed')
            ORDER BY id`,
        )
        .all(),
    ).toEqual([
      {
        id: "event-1",
        starts_at: "2025-02-01T09:00:00.000Z",
        ends_at: "2025-02-01T17:00:00.000Z",
      },
      { id: "event-future", starts_at: "2099-02-01T09:00:00.000Z", ends_at: "2099-02-01T17:00:00.000Z" },
      { id: "event-malformed", starts_at: "not-a-date", ends_at: "also-not-a-date" },
      { id: "event-reversed", starts_at: "2099-03-02T09:00:00.000Z", ends_at: "2099-03-01T17:00:00.000Z" },
    ]);
    expect(db.prepare("SELECT id, invitee_email, status, expires_at FROM invites ORDER BY id").all()).toEqual([
      { id: "invite-bad-event", invitee_email: "bad-event@example.test", status: "expired", expires_at: null },
      { id: "invite-blank", invitee_email: "", status: "expired", expires_at: "2099-02-01T09:00:00.000Z" },
      {
        id: "invite-created-canonical",
        invitee_email: "created-validity@example.test",
        status: "sent",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-created-malformed",
        invitee_email: "created-validity@example.test",
        status: "revoked",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-created-order-new",
        invitee_email: "created-order@example.test",
        status: "sent",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-created-order-old",
        invitee_email: "created-order@example.test",
        status: "revoked",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-early",
        invitee_email: "early@example.test",
        status: "expired",
        expires_at: "2025-02-01T12:00:00.000Z",
      },
      {
        id: "invite-future-new",
        invitee_email: "duplicate@example.test",
        status: "sent",
        expires_at: "2099-02-01T17:00:00.000Z",
      },
      {
        id: "invite-future-old",
        invitee_email: "duplicate@example.test",
        status: "revoked",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-future-tie-a",
        invitee_email: "tie@example.test",
        status: "revoked",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-future-tie-z",
        invitee_email: "tie@example.test",
        status: "sent",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-invalid-missing-at",
        invitee_email: "not-an-email",
        status: "expired",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-invalid-missing-domain",
        invitee_email: "foo@",
        status: "expired",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-invalid-multiple-at",
        invitee_email: "foo@@example.test",
        status: "expired",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-invalid-whitespace",
        invitee_email: "bad address@example.test",
        status: "expired",
        expires_at: "2099-02-01T09:00:00.000Z",
      },
      {
        id: "invite-malformed",
        invitee_email: "malformed@example.test",
        status: "expired",
        expires_at: "not-a-date",
      },
      {
        id: "invite-new",
        invitee_email: "invitee@example.test",
        status: "expired",
        expires_at: "2025-02-01T17:00:00.000Z",
      },
      {
        id: "invite-old",
        invitee_email: "invitee@example.test",
        status: "expired",
        expires_at: "2025-02-01T09:00:00.000Z",
      },
      {
        id: "invite-reversed-event",
        invitee_email: "reversed-event@example.test",
        status: "expired",
        expires_at: null,
      },
    ]);
    expect(
      db
        .prepare(
          `SELECT invite.id
             FROM invites invite
             LEFT JOIN events event ON event.id = invite.event_id
            WHERE invite.status = 'sent'
              AND (
                invite.invitee_email = ''
                OR invite.invitee_email <> lower(trim(invite.invitee_email))
                OR instr(invite.invitee_email, '@') < 2
                OR instr(invite.invitee_email, '@') = length(invite.invitee_email)
                OR length(invite.invitee_email) - length(replace(invite.invitee_email, '@', '')) <> 1
                OR instr(invite.invitee_email, ' ') > 0
                OR instr(invite.invitee_email, char(9)) > 0
                OR instr(invite.invitee_email, char(10)) > 0
                OR instr(invite.invitee_email, char(13)) > 0
                OR invite.expires_at IS NULL
                OR strftime('%Y-%m-%dT%H:%M:%fZ', invite.expires_at) IS NULL
                OR invite.expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', invite.expires_at)
                OR invite.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
                OR strftime('%Y-%m-%dT%H:%M:%fZ', event.starts_at) IS NULL
                OR strftime('%Y-%m-%dT%H:%M:%fZ', event.ends_at) IS NULL
                OR event.starts_at <> strftime('%Y-%m-%dT%H:%M:%fZ', event.starts_at)
                OR event.ends_at <> strftime('%Y-%m-%dT%H:%M:%fZ', event.ends_at)
                OR event.ends_at <= event.starts_at
                OR invite.expires_at > event.ends_at
              )`,
        )
        .all(),
    ).toEqual([]);
    expect(
      db
        .prepare(
          `SELECT id, created_at
             FROM invites
            WHERE id IN ('invite-created-order-old', 'invite-created-order-new')
            ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { id: "invite-created-order-new", created_at: "2025-01-02T09:00:00.000Z" },
      { id: "invite-created-order-old", created_at: "2025-01-02T08:00:00.000Z" },
    ]);
    expect(
      db
        .prepare(
          `SELECT DISTINCT event.id
             FROM events event
             JOIN invites invite ON invite.event_id = event.id
            WHERE strftime('%Y-%m-%dT%H:%M:%fZ', event.starts_at) IS NULL
               OR strftime('%Y-%m-%dT%H:%M:%fZ', event.ends_at) IS NULL
               OR event.starts_at <> strftime('%Y-%m-%dT%H:%M:%fZ', event.starts_at)
               OR event.ends_at <> strftime('%Y-%m-%dT%H:%M:%fZ', event.ends_at)
               OR event.ends_at <= event.starts_at
            ORDER BY event.id`,
        )
        .all(),
    ).toEqual([{ id: "event-malformed" }, { id: "event-reversed" }]);
    expect(
      db
        .prepare(
          `SELECT id
             FROM invites
            WHERE expires_at IS NOT NULL
              AND (
                strftime('%Y-%m-%dT%H:%M:%fZ', expires_at) IS NULL
                OR expires_at <> strftime('%Y-%m-%dT%H:%M:%fZ', expires_at)
              )
            ORDER BY id`,
        )
        .all(),
    ).toEqual([{ id: "invite-malformed" }]);
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
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('auth_magic_links', 'sponsor_portal_magic_links') ORDER BY name",
        )
        .all(),
    ).toEqual([]);
    expect(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sponsor_portal_sessions'").get(),
    ).toBeUndefined();
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
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'uq_permission_grants_active_user_permission_context'",
        )
        .all(),
    ).toEqual([{ name: "uq_permission_grants_active_user_permission_context" }]);
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

  it("rejects cross-aggregate rows at the consolidated schema boundary", () => {
    db = new DatabaseSync(":memory:");
    applyMigrationsBefore0035(db);
    seedRepresentativePre0035State(db);
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, CONSOLIDATED_MIGRATION), "utf8"));

    // D1 enforces foreign keys by default; the consolidated migration must not
    // depend on toggling PRAGMA foreign_keys, which D1 does not permit.
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });

    db.exec(`
      INSERT INTO events (id, slug, name, timezone, created_at, updated_at)
      VALUES ('event-2', 'upgrade-test-2', 'Upgrade test 2', 'UTC', '2025-01-01', '2025-01-01');
      INSERT INTO users (id, email, normalized_email, role, created_at, updated_at)
      VALUES ('user-2', 'second@example.test', 'second@example.test', 'user', '2025-01-01', '2025-01-01');
      INSERT INTO event_days (id, event_id, day_date, created_at, updated_at)
      VALUES ('day-1', 'event-1', '2025-05-01', '2025-01-01', '2025-01-01'),
             ('day-2', 'event-2', '2025-05-01', '2025-01-01', '2025-01-01');
      INSERT INTO registrations
        (id, event_id, user_id, status, attendance_type, source_type, manage_link_secret, created_at, updated_at)
      VALUES ('registration-1', 'event-1', 'admin-1', 'registered', 'virtual', 'test', 'manage-1', '2025-01-01', '2025-01-01'),
             ('registration-2', 'event-2', 'user-2', 'registered', 'virtual', 'test', 'manage-2', '2025-01-01', '2025-01-01');
      INSERT INTO proposal_speakers (id, proposal_id, user_id, role, status, created_at)
      VALUES ('proposal-speaker-1', 'proposal-1', 'admin-1', 'proposer', 'confirmed', '2025-01-01');
      INSERT INTO member_applications
        (id, applicant_email, applicant_name, membership_category, stage_entered_at, manage_token_hash, created_at, updated_at)
      VALUES ('application-1', 'applicant@example.test', 'Applicant', 'F', '2025-01-01', 'application-token', '2025-01-01', '2025-01-01');
    `);

    // Valid registration and proposal evidence are accepted.
    db.prepare(
      `INSERT INTO consent_acceptances
         (id, registration_id, proposal_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
       VALUES (?, ?, NULL, ?, ?, 'attendee', ?, 'v1', datetime('now'))`,
    ).run("consent-registration", "registration-1", "event-1", "admin-1", "privacy");
    db.prepare(
      `INSERT INTO consent_acceptances
         (id, registration_id, proposal_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
       VALUES (?, NULL, ?, ?, ?, 'speaker', ?, 'v1', datetime('now'))`,
    ).run("consent-proposal", "proposal-1", "event-1", "admin-1", "speaker-terms");

    expect(() =>
      db!
        .prepare(
          `INSERT INTO consent_acceptances
           (id, registration_id, proposal_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
         VALUES ('consent-neither', NULL, NULL, 'event-1', 'admin-1', 'attendee', 'neither', 'v1', datetime('now'))`,
        )
        .run(),
    ).toThrow("CONSENT_ACCEPTANCE_CONTEXT_INVALID");
    expect(() =>
      db!
        .prepare(
          `INSERT INTO consent_acceptances
           (id, registration_id, proposal_id, event_id, user_id, audience_type, term_key, term_version, accepted_at)
         VALUES ('consent-cross-event', 'registration-1', NULL, 'event-2', 'admin-1', 'attendee', 'cross-event', 'v1', datetime('now'))`,
        )
        .run(),
    ).toThrow("CONSENT_ACCEPTANCE_CONTEXT_INVALID");

    db.prepare(
      `INSERT INTO registration_day_attendance
         (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
       VALUES ('attendance-1', 'registration-1', 'day-1', 'in_person', '2025-01-01', '2025-01-01')`,
    ).run();
    expect(() =>
      db!
        .prepare(
          `INSERT INTO registration_day_attendance
           (id, registration_id, event_day_id, attendance_type, created_at, updated_at)
         VALUES ('attendance-cross-event', 'registration-1', 'day-2', 'in_person', '2025-01-01', '2025-01-01')`,
        )
        .run(),
    ).toThrow("REGISTRATION_DAY_EVENT_MISMATCH");

    db.prepare(
      `INSERT INTO event_day_waitlist_entries
         (id, event_id, event_day_id, registration_id, user_id, priority_lane, status, position, created_at, updated_at)
       VALUES ('waitlist-1', 'event-1', 'day-1', 'registration-1', 'admin-1', 'general', 'waiting', 1, '2025-01-01', '2025-01-01')`,
    ).run();
    expect(() =>
      db!.prepare("UPDATE event_day_waitlist_entries SET user_id = 'user-2' WHERE id = 'waitlist-1'").run(),
    ).toThrow("WAITLIST_EVENT_CONTEXT_INVALID");

    db.prepare(
      `INSERT INTO organization_domain_claims
         (id, domain, application_id, organization_id, created_at, updated_at)
       VALUES ('domain-application', 'application.example', 'application-1', NULL, '2025-01-01', '2025-01-01')`,
    ).run();
    expect(() =>
      db!
        .prepare(
          `INSERT INTO organization_domain_claims
           (id, domain, application_id, organization_id, created_at, updated_at)
         VALUES ('domain-neither', 'neither.example', NULL, NULL, '2025-01-01', '2025-01-01')`,
        )
        .run(),
    ).toThrow("DOMAIN_CLAIM_OWNER_INVALID");
    expect(() =>
      db!
        .prepare("UPDATE organization_domain_claims SET organization_id = 'member-1' WHERE id = 'domain-application'")
        .run(),
    ).toThrow("DOMAIN_CLAIM_OWNER_INVALID");

    db.prepare(
      `INSERT INTO user_roles
         (id, user_id, role_id, context_type, context_id, created_at)
       VALUES ('role-event-1', 'admin-1', 'role-event_organizer', 'event', 'event-1', '2025-01-01')`,
    ).run();
    expect(() =>
      db!
        .prepare(
          `INSERT INTO user_roles
           (id, user_id, role_id, context_type, context_id, created_at)
         VALUES ('role-invalid-context', 'admin-1', 'role-event_organizer', 'event', 'missing-event', '2025-01-01')`,
        )
        .run(),
    ).toThrow("USER_ROLE_CONTEXT_INVALID");
    expect(() => db!.prepare("DELETE FROM events WHERE id = 'event-1'").run()).toThrow(
      "EVENT_HAS_AUTHORIZATION_CONTEXT",
    );
    expect(() =>
      db!
        .prepare(
          `INSERT INTO permission_grants
           (id, user_id, permission, context_type, context_id, created_at)
         VALUES ('grant-invalid-context', 'admin-1', 'events:read', 'unknown', 'event-1', '2025-01-01')`,
        )
        .run(),
    ).toThrow("PERMISSION_GRANT_CONTEXT_INVALID");

    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});

const AGENDA_PLATFORM_MIGRATION = "0038_event_agenda_platform.sql";

function applyMigrationsBefore0038(db: DatabaseSync): void {
  for (const fileName of fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((name) => /^\d{4}_.+\.sql$/.test(name) && migrationNumber(name) < 38)
    .sort()) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8"));
  }
}

/** D1 applies a migration file as one transaction; deferred foreign keys are checked at its commit. */
function apply0038(db: DatabaseSync): void {
  db.exec("BEGIN");
  try {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, AGENDA_PLATFORM_MIGRATION), "utf8"));
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** Every (table, column) whose foreign key names members(id). */
function tablesReferencingMembers(db: DatabaseSync): Array<{ table: string; column: string }> {
  return db
    .prepare(
      `SELECT m.name AS "table", fk."from" AS "column"
         FROM sqlite_master m, pragma_foreign_key_list(m.name) fk
        WHERE m.type = 'table' AND fk."table" = 'members'
        ORDER BY m.name, fk."from"`,
    )
    .all() as Array<{ table: string; column: string }>;
}

/**
 * Inserts one row, filling every other required column with a synthetic value.
 * Foreign keys other than the ones under test may dangle: the fixture runs with
 * enforcement off, and the comparison below only concerns members(id).
 */
function insertSyntheticRow(db: DatabaseSync, table: string, values: Record<string, string | number | null>): void {
  const columns = db
    .prepare(`SELECT name, type, "notnull" AS required, dflt_value FROM pragma_table_info(?)`)
    .all(table) as Array<{ name: string; type: string; required: number; dflt_value: string | null }>;
  const row: Record<string, string | number | null> = {};
  for (const column of columns) {
    if (column.name in values) row[column.name] = values[column.name];
    else if (column.required && column.dflt_value === null)
      row[column.name] = /INT/i.test(column.type) ? 1 : `${table}-${column.name}`;
  }
  const names = Object.keys(row);
  db.prepare(
    `INSERT INTO ${table} (${names.map((name) => `"${name}"`).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`,
  ).run(...names.map((name) => row[name]));
}

/**
 * Production-shaped membership state before the members rebuild: an
 * organization membership with a representative, an active individual
 * membership, one whose person's personal identity has ended, and dependent
 * rows in every table that references members(id).
 */
function seedMembershipBeforeRebuild(db: DatabaseSync): void {
  const at = "2025-01-01T00:00:00.000Z";
  db.exec(`
    INSERT INTO users (id, email, normalized_email, created_at, updated_at) VALUES
      ('person-org', 'rep@org.example', 'rep@org.example', '${at}', '${at}'),
      ('person-solo', 'solo@example.test', 'solo@example.test', '${at}', '${at}'),
      ('person-lapsed', 'lapsed@example.test', 'lapsed@example.test', '${at}', '${at}');
    INSERT INTO organizations (id, name, normalized_name, created_at, updated_at)
    VALUES ('org-a', 'Alpha', 'alpha', '${at}', '${at}');
    INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
    VALUES ('member-org', 'organization', 'org-a', 'active', '${at}', '${at}');
    INSERT INTO members (id, member_type, user_id, status, tier, member_since, created_at, updated_at) VALUES
      ('member-solo', 'individual', 'person-solo', 'active', 'gold', '2019-05-01', '${at}', '${at}'),
      ('member-lapsed', 'individual', 'person-lapsed', 'lapsed', NULL, NULL, '${at}', '${at}');
    INSERT INTO member_category_assignments (member_id, category_code, created_at, updated_at) VALUES
      ('member-org', 'A', '${at}', '${at}'),
      ('member-solo', 'H6', '${at}', '${at}'),
      ('member-lapsed', 'H5', '${at}', '${at}');
    INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile,
                            invited_at, started_at, ended_at, created_at, updated_at) VALUES
      ('identity-org', 'person-org', 'org-a', 'staff', 1, '${at}', '${at}', NULL, '${at}', '${at}'),
      ('identity-solo', 'person-solo', NULL, 'staff', 0, '${at}', '${at}', NULL, '${at}', '${at}'),
      ('identity-lapsed', 'person-lapsed', NULL, 'staff', 0, '${at}', '${at}', '2025-06-01T00:00:00.000Z',
       '${at}', '2025-06-01T00:00:00.000Z');
    INSERT INTO user_roles (id, user_id, role_id, context_type, context_id, identity_id, member_id, created_at)
    VALUES ('role-contact', 'person-org', 'role-primary_contact', 'organization', 'member-org',
            'identity-org', 'member-org', '${at}');
  `);
  db.exec("PRAGMA foreign_keys = OFF");
  insertSyntheticRow(db, "groups", { id: "group-1", slug: "group-1", eligibility_mode: "open" });
  insertSyntheticRow(db, "group_memberships", {
    id: "seat-solo",
    group_id: "group-1",
    user_id: "person-solo",
    identity_id: "identity-solo",
    member_id: "member-solo",
    joined_at: at,
    left_at: null,
  });
  insertSyntheticRow(db, "member_applications", {
    id: "application-1",
    member_id: "member-org",
    membership_category: "A",
  });
  insertSyntheticRow(db, "organization_secondary_contact_nominations", {
    id: "nomination-1",
    member_id: "member-org",
    nominated_user_id: "person-org",
  });
  for (const table of ["vote_ballots", "vote_consultation_responses", "vote_representative_notification_intents"]) {
    insertSyntheticRow(db, table, { member_id: "member-solo", identity_id: "identity-solo", round: 1 });
  }
  db.exec("PRAGMA foreign_keys = ON");
}

function memberReferenceCounts(db: DatabaseSync, references: Array<{ table: string; column: string }>) {
  return references.map(({ table, column }) => ({
    table,
    column,
    rows: (
      db.prepare(`SELECT COUNT(*) AS total FROM ${table} WHERE "${column}" IN (SELECT id FROM members)`).get() as {
        total: number;
      }
    ).total,
  }));
}

describe("members rebuild: membership belongs to an identity", () => {
  let db: DatabaseSync | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
  });

  it("moves individual memberships to their personal identity and keeps every dependent row", () => {
    db = new DatabaseSync(":memory:");
    applyMigrationsBefore0038(db);
    seedMembershipBeforeRebuild(db);
    const references = tablesReferencingMembers(db);
    // The fixture covers every table that references members(id).
    expect(references.map((reference) => reference.table)).toEqual(
      expect.arrayContaining([
        "group_memberships",
        "member_applications",
        "member_category_assignments",
        "organization_secondary_contact_nominations",
        "user_roles",
        "vote_ballots",
        "vote_consultation_responses",
        "vote_representative_notification_intents",
      ]),
    );
    const counts = memberReferenceCounts(db, references);
    expect(counts.filter((count) => count.rows === 0)).toEqual([]);
    const unrelatedViolations = db.prepare("PRAGMA foreign_key_check").all();

    apply0038(db);

    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    const violations = db.prepare("PRAGMA foreign_key_check").all() as Array<{ parent: string }>;
    expect(violations.filter((violation) => violation.parent === "members")).toEqual([]);
    expect(violations).toEqual(unrelatedViolations);
    expect(tablesReferencingMembers(db)).toEqual(
      [...references, { table: "oauth_authorizations", column: "member_id" }].sort((a, b) =>
        a.table.localeCompare(b.table),
      ),
    );
    expect(memberReferenceCounts(db, references)).toEqual(counts);

    const columns = (db.prepare("SELECT name FROM pragma_table_info('members')").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).not.toContain("user_id");
    expect(
      db
        .prepare(
          "SELECT id, member_type, identity_id, organization_id, status, tier, member_since FROM members ORDER BY id",
        )
        .all(),
    ).toEqual([
      {
        id: "member-lapsed",
        member_type: "individual",
        identity_id: "identity-lapsed",
        organization_id: null,
        status: "lapsed",
        tier: null,
        member_since: null,
      },
      {
        id: "member-org",
        member_type: "organization",
        identity_id: null,
        organization_id: "org-a",
        status: "active",
        tier: null,
        member_since: null,
      },
      {
        id: "member-solo",
        member_type: "individual",
        identity_id: "identity-solo",
        organization_id: null,
        status: "active",
        tier: "gold",
        member_since: "2019-05-01",
      },
    ]);
    expect(
      db.prepare("SELECT identity_id, user_id, member_id FROM identity_member_capacities ORDER BY identity_id").all(),
    ).toEqual([
      { identity_id: "identity-lapsed", user_id: "person-lapsed", member_id: "member-lapsed" },
      { identity_id: "identity-org", user_id: "person-org", member_id: "member-org" },
      { identity_id: "identity-solo", user_id: "person-solo", member_id: "member-solo" },
    ]);

    // Dependent guards are recreated on the rebuilt table.
    expect(() => db!.prepare("DELETE FROM members WHERE id = 'member-org'").run()).toThrow(
      "MEMBERSHIP_HAS_AUTHORIZATION_CONTEXT",
    );
    expect(() =>
      db!.prepare("UPDATE members SET identity_id = 'identity-lapsed' WHERE id = 'member-solo'").run(),
    ).toThrow("MEMBER_HOLDER_IMMUTABLE");
    // A personal identity no longer needs a membership to exist.
    db.exec(`INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile,
                                     invited_at, started_at, created_at, updated_at)
             VALUES ('identity-new', 'person-org', NULL, 'staff', 0, '2025-07-01T00:00:00.000Z', NULL,
                     '2025-07-01T00:00:00.000Z', '2025-07-01T00:00:00.000Z')`);
  });

  it("refuses the whole migration rather than guess an individual membership's identity", () => {
    db = new DatabaseSync(":memory:");
    applyMigrationsBefore0038(db);
    seedMembershipBeforeRebuild(db);
    // A second personal identity, ended, leaves no live one and two candidates.
    db.exec(`UPDATE identities SET ended_at = '2025-06-01T00:00:00.000Z' WHERE id = 'identity-solo';
             INSERT INTO identities (id, user_id, organization_id, source, show_on_organization_profile,
                                     invited_at, started_at, ended_at, created_at, updated_at)
             VALUES ('identity-solo-2', 'person-solo', NULL, 'staff', 0, '2025-06-02T00:00:00.000Z',
                     '2025-06-02T00:00:00.000Z', '2025-07-01T00:00:00.000Z',
                     '2025-06-02T00:00:00.000Z', '2025-07-01T00:00:00.000Z')`);

    expect(() => apply0038(db!)).toThrow(/members_holder/);
    const columns = (db.prepare("SELECT name FROM pragma_table_info('members')").all() as Array<{ name: string }>).map(
      (column) => column.name,
    );
    expect(columns).toContain("user_id");
    expect(db.prepare("SELECT COUNT(*) AS total FROM members").get()).toEqual({ total: 3 });
  });
});

it("upgrades pre-0035 profiles through 0038 so identities alone own organization and title", () => {
  const db = new DatabaseSync(":memory:");
  try {
    applyMigrationsBefore0035(db);
    seedRepresentativePre0035State(db);
    db.exec(`
      UPDATE users SET organization_name = 'ACME  corp', job_title = 'Program chair' WHERE id = 'organizer-1';
      INSERT INTO users (id, email, normalized_email, first_name, organization_name, job_title, role, created_at, updated_at)
      VALUES
        ('unmatched-1', 'unmatched@example.test', 'unmatched@example.test', 'Unmatched', 'Unlisted Labs', 'Analyst',
         'user', '2025-01-01', '2025-01-01'),
        ('individual-1', 'individual@example.test', 'individual@example.test', 'Individual', NULL, 'Consultant',
         'user', '2025-01-01', '2025-01-01');
      INSERT INTO audit_log (id, actor_type, actor_id, action, entity_type, entity_id, details_json, created_at)
      VALUES
        ('organizer-as-user', 'user', 'organizer-1', 'profile_updated', 'user', 'organizer-1', NULL, '2024-11-01 10:00:00'),
        ('organizer-as-admin', 'admin', 'organizer-1', 'event_updated', 'event', 'event-1', NULL, '2025-01-02'),
        ('unmatched-as-user', 'user', 'unmatched-1', 'profile_updated', 'user', 'unmatched-1', NULL, '2025-01-02');
    `);
    for (const fileName of fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((name) => /^\d{4}_.+\.sql$/.test(name) && migrationNumber(name) >= 35)
      .sort()) {
      if (migrationNumber(fileName) === 38) {
        // Event attribution may differ from the current profile. Reconcile
        // owned identities and retain unresolved facts without audit PII.
        db.exec(`
          INSERT INTO members (id, member_type, organization_id, status, created_at, updated_at)
          VALUES ('member-title-fixture', 'organization', 'org-2', 'active', '2025-01-01', '2025-01-01');
          INSERT INTO identities (id, user_id, organization_id, job_title, source, invited_at, started_at, created_at, updated_at)
          VALUES ('historical-registration-identity', 'admin-1', 'org-1', 'Current role', 'staff',
            '2025-01-01', '2025-01-01', '2025-01-01', '2025-01-01'),
            ('missing-title-identity', 'admin-1', 'org-2', NULL, 'staff',
             '2025-01-01', '2025-01-01', '2025-01-01', '2025-01-01');
          INSERT INTO users (id, email, normalized_email, created_at, updated_at, pii_redacted_at)
          VALUES ('redacted-legacy', 'redacted@example.test', 'redacted@example.test',
            '2025-01-01', '2025-01-01', '2025-01-01');
          UPDATE registrations SET registration_organization_name = ' Former  Employer ',
            registration_job_title = 'Past title' WHERE id = 'registration-upgrade';
          INSERT INTO registrations (id, event_id, user_id, status, attendance_type, source_type,
            manage_link_secret, created_at, updated_at, registration_organization_name, registration_job_title)
          VALUES
            ('registration-empty', 'event-future', 'admin-1', 'registered', 'virtual', 'test',
             'empty-secret', '2025-01-01', '2025-01-01', 'Acme Corp', 'Current role'),
            ('registration-null', 'event-reversed', 'organizer-1', 'registered', 'virtual', 'test',
             'null-secret', '2025-01-01', '2025-01-01', NULL, NULL),
            ('registration-redacted', 'event-1', 'redacted-legacy', 'registered', 'virtual', 'test',
             'redacted-secret', '2025-01-01', '2025-01-01', 'Erased affiliation', 'Erased title'),
            ('registration-missing-title', 'event-malformed', 'admin-1', 'registered', 'virtual', 'test',
             'title-secret', '2025-01-01', '2025-01-01', 'Pending Corp', 'Confirmed title'),
            ('registration-title-only', 'event-future', 'organizer-1', 'registered', 'virtual', 'test',
             'personal-title-secret', '2025-01-01', '2025-01-01', '', 'Independent researcher');
          UPDATE registrations SET registration_identity_id = 'historical-registration-identity'
            WHERE id = 'registration-empty';
        `);
      }
      db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8"));
    }

    expect(db.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const columns = (table: string) =>
      (db.prepare(`SELECT name FROM pragma_table_info('${table}')`).all() as Array<{ name: string }>).map(
        (column) => column.name,
      );
    expect(columns("users")).not.toEqual(expect.arrayContaining(["organization_name"]));
    expect(columns("users")).not.toEqual(expect.arrayContaining(["job_title"]));
    expect(columns("registrations")).not.toEqual(expect.arrayContaining(["registration_organization_name"]));
    expect(columns("registrations")).not.toEqual(expect.arrayContaining(["registration_job_title"]));
    expect(db.prepare("SELECT COUNT(*) AS count FROM registrations").get()).toEqual({ count: 6 });

    expect(db.prepare("SELECT job_title FROM identities WHERE id = 'missing-title-identity'").get()).toEqual({
      job_title: "Confirmed title",
    });
    expect(db.prepare("SELECT job_title FROM identities WHERE id = 'historical-registration-identity'").get()).toEqual({
      job_title: "Current role",
    });
    expect(
      db.prepare("SELECT registration_identity_id FROM registrations WHERE id = 'registration-missing-title'").get(),
    ).toEqual({ registration_identity_id: "missing-title-identity" });
    const review = db
      .prepare(
        `SELECT id, source_id, organization_name, job_title FROM affiliation_reviews
      WHERE source_type = 'registration'`,
      )
      .all();
    expect(review).toEqual([
      expect.objectContaining({
        source_id: "registration-upgrade",
        organization_name: "Former  Employer",
        job_title: "Past title",
      }),
    ]);
    expect(
      db
        .prepare(
          `SELECT entity_id, scope_type, scope_id, details_json FROM audit_log
      WHERE action = 'registration_affiliation_review_opened'`,
        )
        .all(),
    ).toEqual([
      {
        entity_id: "registration-upgrade",
        scope_type: "event",
        scope_id: "event-1",
        details_json: JSON.stringify({ reviewId: review[0].id, registrationIdentityId: null }),
      },
    ]);
    expect(
      db
        .prepare(`SELECT COUNT(*) count FROM audit_log WHERE action = 'registration_affiliation_snapshot_retired'`)
        .get(),
    ).toEqual({ count: 0 });

    expect(
      db
        .prepare(
          `SELECT COUNT(*) count FROM audit_log WHERE action IN (
      'identity_created_from_profile', 'identity_job_title_backfilled', 'individual_job_title_retained',
      'proposal_speaker_affiliation_override_removed', 'affiliation_review_opened')
      AND (json_type(details_json, '$.organizationName') IS NOT NULL
        OR json_type(details_json, '$.jobTitle') IS NOT NULL
        OR json_type(details_json, '$.profileOrganizationName') IS NOT NULL
        OR json_type(details_json, '$.domain') IS NOT NULL
        OR json_type(details_json, '$.emailDomain') IS NOT NULL)`,
        )
        .get(),
    ).toEqual({ count: 0 });

    // A name alone never decides an organization: the text waits for review and the person for their own join.
    expect(
      db
        .prepare(
          `SELECT identity.organization_id, identity.job_title, identity.source
             FROM identities identity WHERE identity.user_id = 'organizer-1'`,
        )
        .all(),
    ).toEqual([{ organization_id: null, job_title: null, source: "migration" }]);
    expect(
      db
        .prepare(
          "SELECT user_id, organization_name, job_title FROM affiliation_reviews WHERE source_type = 'user_profile' ORDER BY user_id",
        )
        .all(),
    ).toEqual([
      { user_id: "organizer-1", organization_name: "ACME  corp", job_title: "Program chair" },
      { user_id: "unmatched-1", organization_name: "Unlisted Labs", job_title: "Analyst" },
    ]);
    expect(db.prepare("SELECT user_id, job_title FROM individual_job_titles").all()).toEqual([
      { user_id: "individual-1", job_title: "Consultant" },
      { user_id: "organizer-1", job_title: "Independent researcher" },
    ]);
    expect(
      db
        .prepare(
          `SELECT entry.id, held.user_id, held.organization_id FROM audit_log entry
             LEFT JOIN identities held ON held.id = entry.actor_identity_id
            WHERE entry.id IN ('organizer-as-user', 'organizer-as-admin', 'unmatched-as-user') ORDER BY entry.id`,
        )
        .all(),
    ).toEqual([
      { id: "organizer-as-admin", user_id: "organizer-1", organization_id: null },
      { id: "organizer-as-user", user_id: "organizer-1", organization_id: null },
      { id: "unmatched-as-user", user_id: "unmatched-1", organization_id: null },
    ]);
  } finally {
    db.close();
  }
});

it("splits the agenda platform migration into bounded statements for D1", async () => {
  const migrations = await readD1Migrations(MIGRATIONS_DIR);
  const agendaPlatform = migrations.find((migration) => migration.name === "0038_event_agenda_platform.sql")!;
  expect(agendaPlatform.queries).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/ALTER TABLE users DROP COLUMN organization_name/),
      expect.stringMatching(/CREATE TABLE standing_agenda_awards/),
      expect.stringMatching(/CREATE TABLE sponsorship_periods/),
      expect.stringMatching(/CREATE TABLE oauth_authorizations/),
      expect.stringMatching(/CREATE TABLE oauth_authorization_completions/),
    ]),
  );
  expect(Math.max(...agendaPlatform.queries.map((query) => new TextEncoder().encode(query).byteLength))).toBeLessThan(
    100_000,
  );
});

it("splits the consolidated migration into bounded statements for D1", async () => {
  const migrations = await readD1Migrations(MIGRATIONS_DIR);
  const consolidated = migrations.find((migration) => migration.name === CONSOLIDATED_MIGRATION)!;
  expect(consolidated.queries.length).toBeGreaterThan(500);
  expect(Math.max(...consolidated.queries.map((query) => new TextEncoder().encode(query).byteLength))).toBeLessThan(
    100_000,
  );
});

it("cuts over unfinished promotion work without retaining a second render queue", () => {
  const db = new DatabaseSync(":memory:");
  try {
    applyMigrationsBefore0038(db);
    apply0038(db);
    const at = "2026-10-26T00:00:00.000Z";
    db.prepare(
      "INSERT INTO users(id,email,normalized_email,active,created_at,updated_at) VALUES('queue-user','queue@example.test','queue@example.test',1,?,?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO events(id,slug,name,timezone,created_at,updated_at) VALUES('queue-event','queue-event','Queue event','UTC',?,?)",
    ).run(at, at);
    db.exec(
      "INSERT INTO event_agenda_occurrences(id,event_id,title) VALUES('queue-session','queue-event','Queue session')",
    );
    db.prepare(
      "INSERT INTO event_agenda_promotion_copy(occurrence_id,copy_json,updated_by,updated_at) VALUES('queue-session',?,'queue-user',?)",
    ).run(
      JSON.stringify({
        whyAttend: "A reviewed session introduction",
        takeaways: ["Inventory first", "Plan the migration"],
        callToAction: "Join the session",
        campaign: "speaker-kit",
        approvedAt: null,
      }),
      at,
    );
    const copyBefore = db
      .prepare("SELECT copy_json FROM event_agenda_promotion_copy WHERE occurrence_id='queue-session'")
      .get();
    for (const [index, status] of ["queued", "retrying", "rendering", "rendered", "failed"].entries()) {
      db.prepare(`INSERT INTO event_agenda_promotion_render_jobs(id,event_id,occurrence_id,user_id,revision,format,origin,cache_key,status,attempts,next_attempt_at,processing_token,lease_expires_at,created_at,updated_at)
        VALUES(?,'queue-event','queue-session','queue-user',1,?,'https://example.test',?,?,2,?,'old-lease',?,?,?)`).run(
        status,
        promotionFormatSchema.options[index]!,
        status,
        status,
        at,
        at,
        at,
        at,
      );
    }
    db.exec("BEGIN");
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, "0039_event_promotion_kits.sql"), "utf8"));
    db.exec("COMMIT");
    expect(
      db.prepare("SELECT id,status,fingerprint,processing_token FROM event_promotion_renders ORDER BY id").all(),
    ).toEqual(
      ["queued", "rendering", "retrying"].map((id) => ({
        id,
        status: "queued",
        fingerprint: null,
        processing_token: null,
      })),
    );
    expect(
      db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name IN('event_agenda_promotion_render_jobs','event_agenda_promotion_copy','event_agenda_promotion_downloads','user_email_claims')",
        )
        .all(),
    ).toEqual([]);
    expect(
      db
        .prepare("SELECT promotion_copy_json AS copy_json FROM event_agenda_occurrences WHERE id='queue-session'")
        .get(),
    ).toEqual(copyBefore);
    expect(db.prepare("SELECT id FROM users WHERE id='queue-user'").all()).toEqual([{ id: "queue-user" }]);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally {
    db.close();
  }
});
