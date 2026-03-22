-- Add per-event limit for peer speaker nominations (separate from attendee invite limit).
ALTER TABLE events ADD COLUMN invite_limit_speaker_nomination INTEGER NOT NULL DEFAULT 10;

-- Multi-inviter tracking for social proof and invite deduplication
--
-- Problem: the same person could receive unlimited duplicate invite emails when
-- multiple attendees (or admins) independently invited them.  There was also no
-- check preventing invites to people who had already registered or submitted a
-- proposal.
--
-- Solution:
--   1. A new `invite_inviters` join-table records every user who invited a given
--      invitee.  The main `invites` row is deduplicated to one active row per
--      (event_id, invitee_email, invite_type).  Co-inviters are appended to
--      invite_inviters without triggering a second email.
--   2. The landing page can read all inviters and display social proof such as
--      "You have been invited by Paul, Sven, Chris and 4 others."
--   3. Reminders continue to be sent only against the single canonical invite
--      row, preventing duplicate reminder spam.
--
-- Unique partial index: prevents the same user from appearing twice as a
-- co-inviter for the same invite.

CREATE TABLE invite_inviters (
  id                      TEXT NOT NULL PRIMARY KEY,
  invite_id               TEXT NOT NULL,
  inviter_user_id         TEXT,
  inviter_registration_id TEXT,
  source_type             TEXT NOT NULL DEFAULT 'direct',
  invited_at              TEXT NOT NULL,
  FOREIGN KEY(invite_id) REFERENCES invites(id),
  FOREIGN KEY(inviter_user_id) REFERENCES users(id)
);

CREATE INDEX idx_invite_inviters_invite
  ON invite_inviters(invite_id);

CREATE UNIQUE INDEX idx_invite_inviters_user_dedup
  ON invite_inviters(invite_id, inviter_user_id)
  WHERE inviter_user_id IS NOT NULL;

-- Backfill: carry over the primary inviter from every existing invite row so
-- that historical invite data is surfaced correctly in the social-proof view.
INSERT OR IGNORE INTO invite_inviters
  (id, invite_id, inviter_user_id, inviter_registration_id, source_type, invited_at)
SELECT
  lower(hex(randomblob(16))),
  id,
  inviter_user_id,
  inviter_registration_id,
  source_type,
  created_at
FROM invites
WHERE inviter_user_id IS NOT NULL;
