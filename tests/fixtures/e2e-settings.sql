-- Synthetic standalone event for settings save/cancel and time-zone browser coverage.
INSERT OR IGNORE INTO events (
  id, slug, name, timezone, starts_at, ends_at, registration_mode,
  invite_limit_attendee, settings_json, created_at, updated_at
) VALUES (
  '10000000-0000-4000-8000-000000000047', 'e2e-standalone-settings',
  'Event settings review', 'Europe/Amsterdam',
  '2027-06-10T07:00:00.000Z', '2027-06-10T15:00:00.000Z',
  'no_registration', 5, '{}',
  '2026-09-09T12:00:00.000Z', '2026-09-09T12:00:00.000Z'
);
