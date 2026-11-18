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

-- The domain a representation covered, recorded on the identity, so that ending
-- it retires the address even after the organization removes the claim (see
-- addressNotRetiredSql in auth/email-sign-in-policy.ts): the proved domain, else
-- the organization's most specific claim holding the identity's address. It is
-- recorded when the identity is created and again when it ends or is blocked.
-- Recovery: recomputable from the current claims, as the backfill below does.
ALTER TABLE identities ADD COLUMN covered_email_domain TEXT;

UPDATE identities
   SET covered_email_domain = (SELECT COALESCE(identities.verified_email_domain, (SELECT claim.domain FROM organization_domain_claims claim
     WHERE claim.organization_id = identities.organization_id AND claim.application_id IS NULL
       AND instr('.' || substr(address.normalized_email, instr(address.normalized_email, '@') + 1) || '/',
                 '.' || claim.domain || '/') > 0
     ORDER BY length(claim.domain) DESC, claim.domain LIMIT 1))
     FROM (SELECT COALESCE((SELECT normalized_email FROM user_emails WHERE id = identities.email_id),
                           (SELECT normalized_email FROM users WHERE id = identities.user_id)) AS normalized_email) address)
 WHERE identities.organization_id IS NOT NULL AND (identities.source IN ('verified_email','verified_domain') OR identities.verified_email_domain IS NOT NULL);

CREATE TRIGGER identity_covered_email_domain_on_insert
AFTER INSERT ON identities
WHEN NEW.organization_id IS NOT NULL AND (NEW.source IN ('verified_email','verified_domain') OR NEW.verified_email_domain IS NOT NULL)
BEGIN
  UPDATE identities SET covered_email_domain = (SELECT COALESCE(NEW.verified_email_domain, (SELECT claim.domain FROM organization_domain_claims claim
     WHERE claim.organization_id = NEW.organization_id AND claim.application_id IS NULL
       AND instr('.' || substr(address.normalized_email, instr(address.normalized_email, '@') + 1) || '/',
                 '.' || claim.domain || '/') > 0
     ORDER BY length(claim.domain) DESC, claim.domain LIMIT 1))
     FROM (SELECT COALESCE((SELECT normalized_email FROM user_emails WHERE id = NEW.email_id),
                           (SELECT normalized_email FROM users WHERE id = NEW.user_id)) AS normalized_email) address) WHERE id = NEW.id;
END;

CREATE TRIGGER identity_covered_email_domain_on_end
AFTER UPDATE OF ended_at, blocked_at ON identities
WHEN ((OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL) OR (OLD.blocked_at IS NULL AND NEW.blocked_at IS NOT NULL))
  AND NEW.organization_id IS NOT NULL AND (NEW.source IN ('verified_email','verified_domain') OR NEW.verified_email_domain IS NOT NULL)
BEGIN
  UPDATE identities SET covered_email_domain = COALESCE((SELECT COALESCE(NEW.verified_email_domain, (SELECT claim.domain FROM organization_domain_claims claim
     WHERE claim.organization_id = NEW.organization_id AND claim.application_id IS NULL
       AND instr('.' || substr(address.normalized_email, instr(address.normalized_email, '@') + 1) || '/',
                 '.' || claim.domain || '/') > 0
     ORDER BY length(claim.domain) DESC, claim.domain LIMIT 1))
     FROM (SELECT COALESCE((SELECT normalized_email FROM user_emails WHERE id = NEW.email_id),
                           (SELECT normalized_email FROM users WHERE id = NEW.user_id)) AS normalized_email) address), NEW.covered_email_domain)
   WHERE id = NEW.id;
END;

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
