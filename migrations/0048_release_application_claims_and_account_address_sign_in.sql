-- A membership application no longer holds an email domain. A person's email
-- challenge links an organization to its domain, and an organization applies
-- through the identity of the person who represents it. Release the
-- provisional claims applications held; organization claims are untouched.
-- An open application approved later creates its organization without a
-- claim; the domain is claimed at that organization's next email challenge.
--
-- Data only: the application_id column stays (dropping it needs a table
-- rebuild) and the Worker no longer writes it.
-- Recovery: an open application's claim can be recreated from
-- member_applications.organization_domain, but nothing reads it any more.
DELETE FROM organization_domain_claims WHERE application_id IS NOT NULL;

-- Every verified address on an account signs in while it still speaks for the
-- person; the separate opt-in goes away (see auth/email-sign-in-policy.ts).
-- Applied before the code that uses it; old code keeps working: it still reads
-- user_email_sign_in_permissions, which 0049 drops after the new code is live.

-- The live session check replaces the opt-in's revocation triggers: a session
-- made through an address lives only while that address still signs in.
DROP TRIGGER IF EXISTS revoke_sessions_on_email_sign_in_permission_change;
DROP TRIGGER IF EXISTS revoke_sessions_on_email_sign_in_permission_delete;
DROP TRIGGER IF EXISTS revoke_sign_in_on_email_authority_change;
DROP TRIGGER IF EXISTS revoke_sign_in_on_identity_authority_change;
DROP TRIGGER IF EXISTS revoke_email_sign_in_on_user_lifecycle_change;

-- Removing an address ends the sessions made through it. A session follows the
-- address, not the row: making an address primary swaps the text between the
-- account and the row, and must keep the session of the address that moved.
DROP TRIGGER IF EXISTS revoke_sessions_before_sign_in_email_delete;
CREATE TRIGGER revoke_sessions_before_sign_in_email_delete
BEFORE DELETE ON user_emails
BEGIN
  UPDATE sessions SET revoked_at = COALESCE(revoked_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
   WHERE user_id = OLD.user_id
     AND id IN (SELECT session_id FROM session_email_authentication
                 WHERE normalized_email = OLD.normalized_email);
END;

CREATE INDEX idx_session_email_authentication_address ON session_email_authentication(normalized_email);

-- The first sign-in through an added address sends a security notice once.
ALTER TABLE user_emails ADD COLUMN first_signed_in_at TEXT;

-- Addresses that already signed in under the opt-in have had their first sign-in.
UPDATE user_emails
   SET first_signed_in_at = (
     SELECT MIN(marker.created_at) FROM session_email_authentication marker WHERE marker.email_id = user_emails.id)
 WHERE first_signed_in_at IS NULL
   AND EXISTS (SELECT 1 FROM session_email_authentication marker WHERE marker.email_id = user_emails.id);
