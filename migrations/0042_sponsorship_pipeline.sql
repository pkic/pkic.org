-- Migration 0042: Sponsorship Management
--
-- `sponsorships`/`sponsorship_events` already exist (migration 0034, pulled
-- forward for inquiry/checkout endpoints) with every column
-- schema calls for. What's still missing for the full sales-pipeline/
-- sponsor-portal feature:
--
-- 1. `organizations.sponsor_tier`/`sponsor_start_date` — written when a
--    consortium sponsorship goes active, cleared when it lapses.
-- 2. `event_sponsor_attendee_tiers` — per-event config of which sponsor
--    tiers get attendee-data access.
-- 3. `sponsor_portal_magic_links`/`sponsor_portal_sessions` — a sponsor
--    contact has no `users` row ("no separate account
--    required"), so the existing `auth_magic_links`/`sessions` tables
--    (both `user_id NOT NULL`) can't be reused the way member/admin auth
--    does. These are the same shape, scoped to `sponsorship_id` instead.
-- 4. Migrate the live `sponsors`/`sponsor_events` rows into
--    `sponsorships`/`sponsorship_events` (reconciled by `organization_id`
--    against anything already there), then drop the legacy tables,
--    that drop only happens "after the migration
--    is verified".
-- 5. New email templates (`sponsorship-renewal-reminder-60`/`-30`,
--    `sponsorship-lapsed-staff`, `sponsorship-active-confirmation`,
--    `sponsor-portal-access`) — `sponsorship-brochure`/`sponsorship-new-inquiry`
--    already shipped in migration 0034.
--
-- No CHECK constraints, per this repo's standing convention — allowed
-- values are documented in `-- allowed:` comments and validated at the
-- application layer (Zod) instead.

-- ── organizations: active consortium sponsorship ("On active") ─────

ALTER TABLE organizations ADD COLUMN sponsor_tier TEXT;
-- Titanium/Diamond/Platinum/Gold/Silver, or NULL if not currently sponsoring.
ALTER TABLE organizations ADD COLUMN sponsor_start_date TEXT;

-- ── Per-event sponsor-tier attendee-data-access config ───────────

CREATE TABLE event_sponsor_attendee_tiers (
  id                       TEXT NOT NULL PRIMARY KEY,
  event_id                 TEXT NOT NULL REFERENCES events(id),
  tier_name                TEXT NOT NULL,
  has_attendee_data_access INTEGER NOT NULL DEFAULT 0,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL,
  UNIQUE(event_id, tier_name)
);

-- ── Sponsor portal auth (no `users` row — see header) ─────────────────────

CREATE TABLE sponsor_portal_magic_links (
  id              TEXT NOT NULL PRIMARY KEY,
  sponsorship_id  TEXT NOT NULL REFERENCES sponsorships(id),
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TEXT NOT NULL,
  used_at         TEXT,
  request_ip_hash TEXT,
  user_agent_hash TEXT,
  created_at      TEXT NOT NULL
);

CREATE TABLE sponsor_portal_sessions (
  id             TEXT NOT NULL PRIMARY KEY,
  sponsorship_id TEXT NOT NULL REFERENCES sponsorships(id),
  token_hash     TEXT NOT NULL UNIQUE,
  expires_at     TEXT NOT NULL,
  revoked_at     TEXT,
  created_at     TEXT NOT NULL
);

CREATE INDEX idx_sponsor_portal_sessions_sponsorship ON sponsor_portal_sessions(sponsorship_id);

-- ── Migrate live `sponsors`/`sponsor_events` rows first ───────
-- (must run before any future YAML-scan pass — see scripts/migrate-sponsors-yaml-to-d1.mjs
-- ). Reconciled by organization_id so re-running
-- this migration's logic (it isn't re-run — migrations apply once — but the
-- guard mirrors the YAML script's own idempotency) never double-inserts.

INSERT INTO sponsorships (id, sponsor_type, organization_id, tier, pipeline_stage, start_date, created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'consortium', s.organization_id, s.sponsorship_level,
       CASE WHEN s.status = 'active' THEN 'active' ELSE 'lapsed' END,
       NULL, s.created_at, s.updated_at
FROM sponsors s
WHERE NOT EXISTS (
  SELECT 1 FROM sponsorships sp WHERE sp.organization_id = s.organization_id AND sp.sponsor_type = 'consortium'
);

UPDATE organizations
SET sponsor_tier = (
      SELECT s.sponsorship_level FROM sponsors s WHERE s.organization_id = organizations.id AND s.status = 'active'
    ),
    sponsor_start_date = (
      SELECT s.created_at FROM sponsors s WHERE s.organization_id = organizations.id AND s.status = 'active'
    )
WHERE id IN (SELECT organization_id FROM sponsors WHERE status = 'active');

INSERT INTO sponsorships
  (id, sponsor_type, organization_id, non_member_name, event_id, tier, pipeline_stage, start_date, created_at, updated_at)
SELECT lower(hex(randomblob(16))), 'event', s.organization_id,
       CASE WHEN s.organization_id IS NULL THEN 'Legacy sponsor #' || se.sponsor_id ELSE NULL END,
       se.event_id, se.sponsorship_level,
       CASE WHEN se.status = 'active' THEN 'active' ELSE 'lapsed' END,
       NULL, se.created_at, se.updated_at
FROM sponsor_events se
JOIN sponsors s ON s.id = se.sponsor_id
WHERE NOT EXISTS (
  SELECT 1 FROM sponsorships sp
  WHERE sp.event_id = se.event_id
    AND sp.sponsor_type = 'event'
    AND (sp.organization_id = s.organization_id OR (sp.organization_id IS NULL AND s.organization_id IS NULL))
);

-- No synthetic sponsorship_events audit rows are backfilled for these
-- migrated records — there's no reliable way from SQL alone to tell a
-- freshly-migrated sponsorships row apart from one that already existed
-- (both now satisfy the same WHERE NOT EXISTS guards above), and the
-- migration is a one-time, non-repeatable operation. sponsorship_events
-- starts recording history from the first real pipeline_stage change made
-- through the app after this migration runs, same as any other row created
-- directly by SQL rather than through createSponsorshipInquiry.

DROP TABLE sponsor_events;
DROP TABLE sponsors;

-- ── New email templates ───────────────────────────────────────────

INSERT OR IGNORE INTO email_template_versions
  (id, template_key, version, subject_template, body, content_type, r2_object_key, checksum_sha256, status, created_by_user_id, created_at, message_type)
VALUES
  (
    lower(hex(randomblob(16))), 'sponsorship-renewal-reminder-60', 1,
    'Sponsorship renewal due in 60 days: {{organizationName}}',
    'The {{tier}} sponsorship for {{organizationName}} renews on {{renewalDate}} (60 days from now).

[View sponsorship]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-renewal-reminder-30', 1,
    'Sponsorship renewal due in 30 days: {{organizationName}}',
    'The {{tier}} sponsorship for {{organizationName}} renews on {{renewalDate}} (30 days from now).

[View sponsorship]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-lapsed-staff', 1,
    'Sponsorship lapsed: {{organizationName}}',
    'The {{tier}} sponsorship for {{organizationName}} passed its renewal date ({{renewalDate}}) with no renewal recorded and has been automatically marked lapsed.

[View sponsorship]({{adminUrl}})',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsorship-active-confirmation', 1,
    'Your PKI Consortium sponsorship is now active',
    'Hi {{contactName}},

Your {{tier}} sponsorship for {{organizationName}} is now active{{#startDate}} as of {{startDate}}{{/startDate}}. Thank you for supporting the PKI Consortium.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  ),
  (
    lower(hex(randomblob(16))), 'sponsor-portal-access', 1,
    'Access your sponsor portal',
    'Hi {{contactName}},

As a {{tier}} sponsor of {{eventName}}, you can view and export basic attendee information for attendees who agreed to share their details with sponsors.

[Access your sponsor portal]({{portalUrl}})

This link expires in {{expiresInMinutes}} minutes; you can request a new one at any time from the sponsor portal sign-in page.',
    'markdown', NULL, '', 'active', NULL, datetime('now'), 'transactional'
  );
