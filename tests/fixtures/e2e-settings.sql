-- Production migration assigns the imported PQC conference to the PQC working
-- group. Keep the browser fixture in that same post-migration state so legacy
-- event URLs exercise their redirect into the canonical group workspace.
UPDATE events
SET owner_group_id = '20000000-0000-4000-8000-000000000003',
    profile_key = COALESCE(profile_key, 'conference'),
    source_mode = COALESCE(source_mode, 'hugo')
WHERE slug = 'pqc-conference-amsterdam-nl';

-- Synthetic group-owned event for settings save/cancel and time-zone browser coverage.
INSERT OR IGNORE INTO events (
  id, slug, name, timezone, starts_at, ends_at, registration_mode,
  invite_limit_attendee, settings_json, owner_group_id, profile_key, source_mode,
  created_at, updated_at
) VALUES (
  '10000000-0000-4000-8000-000000000047', 'e2e-standalone-settings',
  'Event settings review', 'Europe/Amsterdam',
  '2027-06-10T07:00:00.000Z', '2027-06-10T15:00:00.000Z',
  'no_registration', 5, '{}',
  '20000000-0000-4000-8000-000000000003', 'conference', 'portal',
  '2026-09-09T12:00:00.000Z', '2026-09-09T12:00:00.000Z'
);
