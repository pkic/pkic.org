-- Migration 0046: Meeting Calendar Management
--
-- Replaces the static ICS files committed to the pkic/members Git repo with
-- a portal-managed system: meeting_series (one per recurring meeting, e.g.
-- "Main Consortium Meeting" or "PQC WG Meeting"), meeting_ics_files (one or
-- more time-slot variants per series, R2-backed), and
-- member_meeting_preferences (a member's chosen variant per series, NULL
-- meaning "send me all variants").
--
-- No CHECK constraints, per this repo's standing convention — allowed
-- values are documented in `-- allowed:` comments and validated at the
-- application layer (Zod) instead.

CREATE TABLE meeting_series (
  id                TEXT NOT NULL PRIMARY KEY,
  name              TEXT NOT NULL,
  scope_type        TEXT NOT NULL,
  -- allowed: consortium | working_group
  working_group_id  TEXT REFERENCES working_groups(id),
  active            INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_meeting_series_wg ON meeting_series(working_group_id);
CREATE INDEX idx_meeting_series_scope_active ON meeting_series(scope_type, active);

CREATE TABLE meeting_ics_files (
  id                   TEXT NOT NULL PRIMARY KEY,
  series_id            TEXT NOT NULL REFERENCES meeting_series(id),
  label                TEXT NOT NULL,
  -- e.g. '09:00 CET', '17:00 CET'
  year                 INTEGER NOT NULL,
  r2_key               TEXT NOT NULL,
  active               INTEGER NOT NULL DEFAULT 1,
  uploaded_by_user_id  TEXT REFERENCES users(id),
  created_at           TEXT NOT NULL
);

CREATE INDEX idx_meeting_ics_files_series_active ON meeting_ics_files(series_id, active);

CREATE TABLE member_meeting_preferences (
  id           TEXT NOT NULL PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  series_id    TEXT NOT NULL REFERENCES meeting_series(id),
  ics_file_id  TEXT REFERENCES meeting_ics_files(id),
  -- ics_file_id NULL means no preference (receives all variants)
  set_at       TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(user_id, series_id)
);

CREATE INDEX idx_member_meeting_preferences_user ON member_meeting_preferences(user_id);

-- ── Seed the initial meeting series ("Seeded on Migration") ─────────
-- Only meeting_series rows are seeded here — the actual ICS file content
-- (currently 9 files committed to pkic/members/meetings/) is not migrated
-- automatically; staff upload each variant via the new admin endpoints
-- after this migration runs, own "staff to verify exact file
-- count at migration time" note. Seeding fake meeting_ics_files rows with
-- placeholder r2_key values was considered and rejected — it would let a
-- staff admin flip one active before the real R2 upload happens, producing
-- a 404 on download.

INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
VALUES (lower(hex(randomblob(16))), 'Main Consortium Meeting', 'consortium', NULL, 1, datetime('now'), datetime('now'));

INSERT INTO meeting_series (id, name, scope_type, working_group_id, active, created_at, updated_at)
SELECT lower(hex(randomblob(16))), wg.name || ' Meeting', 'working_group', wg.id, 1, datetime('now'), datetime('now')
FROM working_groups wg
WHERE wg.slug IN ('pqc', 'cbom', 'cm', 'tcwg', 'ca', 'pkimm');

-- ── New email templates ───────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'wg-calendar-invite', 1,
    'Calendar invite: {{workingGroupName}}',
    'Hi {{memberName}},

You have been added to the {{workingGroupName}} mailing list. Attached is the calendar invite for its recurring meeting — pick whichever time-slot variant works best for your time zone.

You can change your preferred time slot at any time in the portal under My Account → Calendar Invites.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'calendar-invite-resend', 1,
    'Updated calendar invite: {{seriesName}}',
    'Hi {{memberName}},

Attached is this year''s calendar invite for {{seriesName}}. {{#hasPreference}}This matches your saved time-slot preference.{{/hasPreference}}{{^hasPreference}}You have no saved time-slot preference, so all available variants are attached — pick whichever works best for you.{{/hasPreference}}

You can set or change your preference at any time in the portal under My Account → Calendar Invites.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );
