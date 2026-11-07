-- Bind a late response to the invitation generation it answered. Rotating or replacing an invitation invalidates the response.
ALTER TABLE proposal_speakers ADD COLUMN response_invite_generation INTEGER;

-- A late willingness response stays pending until an organizer approves it.
-- Pending responses confer no event role or capacity exemption.
DROP VIEW event_participant_role_sources;
CREATE VIEW event_participant_role_sources AS
SELECT
  'event_participant:' || ep.id AS source_key,
  'event_participant' AS source_kind,
  ep.id AS source_id,
  ep.event_id,
  ep.user_id,
  ep.role,
  ep.subrole,
  ep.status,
  ep.source_type,
  ep.source_ref
FROM event_participants ep
WHERE COALESCE(ep.source_type, '') <> 'proposal'
  AND (
    ep.role <> 'attendee'
    OR NOT EXISTS (
      SELECT 1
      FROM registrations registration_source
      WHERE registration_source.event_id = ep.event_id
        AND registration_source.user_id = ep.user_id
    )
  )
UNION ALL
SELECT
  'registration:' || r.id AS source_key,
  'registration' AS source_kind,
  r.id AS source_id,
  r.event_id,
  r.user_id,
  'attendee' AS role,
  NULL AS subrole,
  CASE r.status
    WHEN 'registered' THEN 'active'
    WHEN 'pending_email_confirmation' THEN 'invited'
    WHEN 'waitlisted' THEN 'waitlisted'
    ELSE 'inactive'
  END AS status,
  r.source_type,
  r.source_ref
FROM registrations r
UNION ALL
SELECT
  'proposal_speaker:' || ps.id AS source_key,
  'proposal_speaker' AS source_kind,
  ps.id AS source_id,
  sp.event_id,
  ps.user_id,
  CASE ps.role
    WHEN 'moderator' THEN 'moderator'
    WHEN 'panelist' THEN 'panelist'
    WHEN 'proposer' THEN 'speaker'
    WHEN 'speaker' THEN 'speaker'
    WHEN 'co_speaker' THEN 'speaker'
  END AS role,
  CASE ps.role
    WHEN 'moderator' THEN NULL
    WHEN 'panelist' THEN NULL
    WHEN 'proposer' THEN 'proposer'
    WHEN 'speaker' THEN 'speaker'
    WHEN 'co_speaker' THEN 'co_speaker'
  END AS subrole,
  CASE
    WHEN sp.status = 'accepted' AND sp.deleted_at IS NULL AND ps.status IN ('invited', 'confirmed') THEN 'active'
    ELSE 'inactive'
  END AS status,
  'proposal' AS source_type,
  ps.proposal_id AS source_ref
FROM proposal_speakers ps
JOIN session_proposals sp ON sp.id = ps.proposal_id
WHERE ps.role IN ('proposer', 'speaker', 'co_speaker', 'moderator', 'panelist');
