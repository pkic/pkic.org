-- Replace stored one-token hashes with stable per-resource revocation secrets.
-- Existing hash values already contain high-entropy random material, so they are
-- safe to reuse as the initial secrets. Old raw-token links intentionally stop
-- working when the application switches to signed capability links.

ALTER TABLE registrations RENAME COLUMN confirmation_token_hash TO confirmation_link_secret;
ALTER TABLE registrations RENAME COLUMN manage_token_hash TO manage_link_secret;

-- Preserve the effective business deadline before removing the redundant
-- per-token expiry column. Signed links carry their own cryptographic expiry.
UPDATE registrations
SET pending_confirmation_deadline_at = COALESCE(
  pending_confirmation_deadline_at,
  confirmation_token_expires_at
)
WHERE status = 'pending_email_confirmation';

ALTER TABLE registrations DROP COLUMN confirmation_token_expires_at;

ALTER TABLE invites RENAME COLUMN token_hash TO link_secret;
ALTER TABLE session_proposals RENAME COLUMN manage_token_hash TO manage_link_secret;
ALTER TABLE proposal_speakers RENAME COLUMN manage_token_hash TO manage_link_secret;

-- Older speaker rows were allowed to omit a management token. Their secrets
-- are initialized on first link issuance using Workers Web Crypto.

DROP INDEX IF EXISTS idx_proposal_speakers_manage_token;
CREATE UNIQUE INDEX idx_proposal_speakers_manage_link_secret
  ON proposal_speakers(manage_link_secret)
  WHERE manage_link_secret IS NOT NULL;
