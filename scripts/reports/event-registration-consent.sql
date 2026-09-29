-- Report only: temporal candidates, never evidence of consent or a deletion list.
-- Parameters: UTC created-from (inclusive), created-until (exclusive),
-- after-created-at, after-identity-id, page size (1..100).
-- Advance the cursor with the final row's identity_created_at and identity_id.
WITH candidates AS (
  SELECT i.id AS identity_id, i.user_id, i.organization_id,
         i.created_at AS identity_created_at, i.started_at, i.ended_at,
         i.blocked_at, i.updated_at AS identity_updated_at
    FROM identities i
   WHERE i.source = 'verified_domain'
     AND i.created_at >= ?1 AND i.created_at < ?2
     AND (i.created_at > ?3 OR (i.created_at = ?3 AND i.id > ?4))
     AND EXISTS (
       SELECT 1 FROM registrations r
        WHERE r.user_id = i.user_id AND r.confirmed_at IS NOT NULL
          AND ABS((julianday(r.confirmed_at) - julianday(i.created_at)) * 86400) <= 300
     )
   ORDER BY i.created_at, i.id
   LIMIT MIN(100, MAX(1, ?5))
)
SELECT c.identity_id, c.user_id, c.organization_id, c.identity_created_at,
       c.started_at, c.ended_at, c.blocked_at, c.identity_updated_at,
       (SELECT json_group_array(r.id) FROM registrations r
         WHERE r.user_id = c.user_id AND r.confirmed_at IS NOT NULL
           AND ABS((julianday(r.confirmed_at) - julianday(c.identity_created_at)) * 86400) <= 300
       ) AS nearby_registration_ids,
       EXISTS (SELECT 1 FROM user_roles role WHERE role.identity_id = c.identity_id)
         AS has_role_history,
       EXISTS (SELECT 1 FROM group_memberships seat WHERE seat.identity_id = c.identity_id)
         AS has_group_history,
       EXISTS (SELECT 1 FROM group_memberships seat
                WHERE seat.identity_id = c.identity_id AND seat.source <> 'automatic_policy')
         AS has_explicit_or_managed_group_history,
       EXISTS (SELECT 1 FROM vote_ballots ballot WHERE ballot.identity_id = c.identity_id)
         AS has_ballot_history,
       EXISTS (SELECT 1 FROM mailing_list_subscription_preferences preference
                WHERE preference.user_id = c.user_id)
         AS has_mailing_preference_history,
       EXISTS (SELECT 1 FROM google_groups_membership_desired_state desired
                WHERE desired.user_id = c.user_id)
         AS has_mailing_delivery_state,
       EXISTS (SELECT 1 FROM audit_log audit
                WHERE audit.entity_id = c.identity_id AND audit.created_at > c.identity_created_at)
         AS has_later_identity_audit,
       EXISTS (SELECT 1 FROM identities successor WHERE successor.predecessor_identity_id = c.identity_id)
         AS has_successor_identity
  FROM candidates c
 ORDER BY c.identity_created_at, c.identity_id;
