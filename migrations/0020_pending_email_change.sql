-- Track pending email changes during verification workflow
-- Allows users to change email without violating UNIQUE constraint until verified
ALTER TABLE users ADD COLUMN pending_email TEXT;
ALTER TABLE users ADD COLUMN pending_email_expires_at TEXT;

-- Ensure only one pending email per user (null is allowed)
CREATE UNIQUE INDEX idx_users_pending_email_unique ON users(pending_email) WHERE pending_email IS NOT NULL;

-- Track soft-merged user accounts so audit trails and other registrations
-- remain navigable after a merge during email-change finalization.
ALTER TABLE users ADD COLUMN merged_into_user_id TEXT;
CREATE INDEX idx_users_merged_into_user_id ON users(merged_into_user_id) WHERE merged_into_user_id IS NOT NULL;
