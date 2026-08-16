-- Migration 0042: Secondary email addresses + user merge support
--
-- Follow-up to a real, visible problem from the YAML->D1 migration:
-- Google Groups roster CSVs used different email addresses than
-- people's canonical one, so a meaningful number of WG-roster-only emails
-- got their own bare `users` rows created rather than being recognized as
-- the same person -- real staff/members show up more than once in the
-- Users admin list, with no way to record "this account also goes by this
-- other email" or clean up the duplicates already sitting in D1.
--
-- `users.email`/`normalized_email` remain the sole login-identifying
-- columns (NOT NULL UNIQUE, unchanged) -- this table only adds
-- admin-visible/searchable alternate emails; it does not affect magic-link
-- or passkey authentication, which continue to resolve strictly off
-- `users.normalized_email`.
--
-- The merge tool built against this table reuses `users.merged_into_user_id`,
-- which already exists (migration 0020_pending_email_change.sql) for a
-- different collision scenario (registration email-change finalization) --
-- no new column needed there, just a second write path.

CREATE TABLE user_emails (
  id               TEXT NOT NULL PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  email            TEXT NOT NULL,
  normalized_email TEXT NOT NULL UNIQUE,
  created_at       TEXT NOT NULL
);

CREATE INDEX idx_user_emails_user ON user_emails(user_id);
