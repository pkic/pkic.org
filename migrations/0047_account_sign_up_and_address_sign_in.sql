-- Apply as the deploy that carries this code starts: the code before it reads
-- user_email_sign_in_permissions, which this migration drops, and the new code
-- reads the columns and table added here.
--
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

-- The live session check replaces the opt-in's revocation triggers: a session
-- made through an address lives only while that address still signs in.
DROP TRIGGER IF EXISTS revoke_sessions_on_email_sign_in_permission_change;
DROP TRIGGER IF EXISTS revoke_sessions_on_email_sign_in_permission_delete;
DROP TRIGGER IF EXISTS revoke_sign_in_on_email_authority_change;
DROP TRIGGER IF EXISTS revoke_sign_in_on_identity_authority_change;
DROP TRIGGER IF EXISTS revoke_email_sign_in_on_user_lifecycle_change;
-- Nothing references the opt-in any more. session_email_authentication.
-- permission_revision is no longer read; new rows carry a constant until a later
-- cleanup can drop the column.
DROP TABLE IF EXISTS user_email_sign_in_permissions;

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

-- The policies an account accepted when it was started (the privacy policy and
-- the code of conduct, see assets/shared/account-policies.ts). Additive;
-- recovery: drop the table.
CREATE TABLE account_policy_acceptances (
  id              TEXT NOT NULL PRIMARY KEY,
  user_id         TEXT NOT NULL,
  term_key        TEXT NOT NULL,
  term_version    TEXT NOT NULL,
  accepted_at     TEXT NOT NULL,
  ip_hash         TEXT,
  user_agent_hash TEXT,
  UNIQUE(user_id, term_key, term_version),
  FOREIGN KEY(user_id) REFERENCES users(id)
);

-- Events no longer ask for the privacy policy or the code of conduct: every
-- account takes them on when it is started. The terms stay, inactive, so past
-- consent records still name what was accepted. Recovery: set active = 1.
UPDATE event_terms SET active = 0
 WHERE active = 1 AND term_key IN ('privacy-policy', 'code-of-conduct');

-- Sessions an email link made before this deploy carry no address marker when
-- they went through the primary address, so the live check cannot end them.
-- End those whose primary address is now retired: an organization identity
-- that covered its domain has ended and none is active (the same rule as
-- addressNotRetiredSql in auth/email-sign-in-policy.ts). Only open sessions an
-- email link made are touched; passkey sessions stay. The person signs in again.
-- A sign-in or sponsor link audits the session it made. A membership join link
-- audits the member instead, in the same command and just before the session
-- row, so its session is the one made for that person right after the audit.
UPDATE sessions
   SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE revoked_at IS NULL
   AND expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
   AND NOT EXISTS (SELECT 1 FROM session_email_authentication marker WHERE marker.session_id = sessions.id)
   AND NOT EXISTS (SELECT 1 FROM audit_log passkey
                    WHERE passkey.entity_type = 'identity_session' AND passkey.entity_id = sessions.id
                      AND passkey.action = 'passkey_authenticated')
   AND (EXISTS (SELECT 1 FROM audit_log made
                 WHERE made.entity_type = 'identity_session' AND made.entity_id = sessions.id
                   AND made.action IN ('user_magic_link_verified', 'sponsor_magic_link_verified'))
     OR EXISTS (SELECT 1 FROM audit_log joined
                 WHERE joined.action = 'membership_join_email_verified' AND joined.actor_type = 'user'
                   AND joined.actor_id = sessions.user_id
                   AND joined.created_at <= sessions.created_at
                   AND joined.created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', sessions.created_at, '-60 seconds')))
   AND EXISTS (
     SELECT 1 FROM users person
      WHERE person.id = sessions.user_id
        AND COALESCE((SELECT MAX(covering.ended_at IS NULL AND covering.blocked_at IS NULL)
              FROM identities covering
              LEFT JOIN organization_domain_claims claim
                ON claim.organization_id = covering.organization_id AND claim.application_id IS NULL
             WHERE covering.user_id = person.id AND covering.organization_id IS NOT NULL
               AND covering.started_at IS NOT NULL
               AND (covering.source IN ('verified_email','verified_domain') OR covering.verified_email_domain IS NOT NULL)
               AND (instr('.' || substr(person.normalized_email, instr(person.normalized_email, '@') + 1) || '/',
                          '.' || covering.covered_email_domain || '/') > 0
                 OR instr('.' || substr(person.normalized_email, instr(person.normalized_email, '@') + 1) || '/',
                          '.' || claim.domain || '/') > 0)), 1) = 0);
