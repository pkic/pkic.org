-- Apply only after the code from 0048 is live: older code reads this table.
-- Nothing references it; its triggers were dropped in 0048.
-- session_email_authentication.permission_revision is no longer read; new rows
-- carry a constant until a later cleanup can drop the column.
DROP TABLE IF EXISTS user_email_sign_in_permissions;

-- 0048 released the claims applications held, but the code live until this
-- deploy could still write new ones; release those too.
DELETE FROM organization_domain_claims WHERE application_id IS NOT NULL;

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
