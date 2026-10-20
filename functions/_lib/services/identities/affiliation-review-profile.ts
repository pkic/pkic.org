/** Complete the canonical organization profile from the migration's retained source evidence. */
import type { DatabaseLike, StatementLike } from "../../types";

// Field-by-field precedence: most recent speaker detail, registration detail, then account detail.
// The speaker must have named this organization; another employer's biography is never borrowed.
const PROFILE_SQL = `SELECT
  (SELECT NULLIF(trim(review.job_title), '') FROM affiliation_reviews review
    JOIN organizations organization ON organization.normalized_name = review.normalized_name
    LEFT JOIN proposal_speakers speaker ON review.source_type = 'proposal_speaker' AND speaker.id = review.source_id
    LEFT JOIN registrations registration ON review.source_type = 'registration' AND registration.id = review.source_id
    WHERE review.user_id = ? AND organization.id = ? AND NULLIF(trim(review.job_title), '') IS NOT NULL
    ORDER BY CASE review.source_type WHEN 'proposal_speaker' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END,
      COALESCE(speaker.created_at, registration.created_at, review.created_at) DESC, review.id DESC LIMIT 1) AS job_title,
  COALESCE(
    (SELECT NULLIF(trim(json_extract(history.details_json, '$.profileOverrides.from.biography')), '')
      FROM proposal_speakers speaker JOIN audit_log history ON history.entity_id = speaker.id
        AND history.entity_type = 'proposal_speaker' AND history.action = 'proposal_speaker_profile_override_removed'
      WHERE speaker.user_id = ? AND json_valid(history.details_json)
        AND NULLIF(trim(json_extract(history.details_json, '$.profileOverrides.from.biography')), '') IS NOT NULL
        AND EXISTS (SELECT 1 FROM affiliation_reviews review JOIN organizations organization ON organization.normalized_name = review.normalized_name
          WHERE review.source_type = 'proposal_speaker' AND review.source_id = speaker.id AND review.user_id = speaker.user_id AND organization.id = ?)
      ORDER BY speaker.created_at DESC, history.created_at DESC, history.id DESC LIMIT 1),
    (SELECT NULLIF(trim(json_extract(history.details_json, '$.biography.from')), '') FROM audit_log history
      WHERE history.entity_type = 'user' AND history.entity_id = ? AND history.action = 'person_profile_moved_to_identity'
        AND json_valid(history.details_json)
        AND EXISTS (SELECT 1 FROM affiliation_reviews review JOIN organizations organization ON organization.normalized_name = review.normalized_name
          WHERE review.user_id = history.entity_id AND organization.id = ? AND review.source_type IN ('registration', 'user_profile'))
      ORDER BY history.created_at DESC, history.id DESC LIMIT 1)
  ) AS biography`;

const NEEDS_PROFILE_SQL = `target.id = ? AND target.user_id = ? AND target.organization_id = ?
  AND target.started_at IS NOT NULL AND target.ended_at IS NULL AND target.blocked_at IS NULL
  AND ((NULLIF(trim(target.job_title), '') IS NULL AND recovered.job_title IS NOT NULL)
    OR (NULLIF(trim(target.biography), '') IS NULL AND recovered.biography IS NOT NULL))`;

/** Never replaces a profile the person or staff already edited; personal identity data is left intact. */
export function prepareAffiliationReviewProfileRecovery(
  db: DatabaseLike,
  input: {
    userId: string;
    organizationId: string;
    identityId: string;
    at: string;
  },
): StatementLike[] {
  const profileBindings = [
    input.userId,
    input.organizationId,
    input.userId,
    input.organizationId,
    input.userId,
    input.organizationId,
  ];
  const targetBindings = [input.identityId, input.userId, input.organizationId];
  return [
    db
      .prepare(`INSERT INTO audit_log(id,actor_type,actor_id,action,entity_type,entity_id,details_json,created_at)
      SELECT lower(hex(randomblob(16))), 'system', NULL, 'identity_profile_recovered', 'identity', target.id,
        json_object('source', json_object('from', NULL, 'to', 'historical_affiliation_reviews'),
          'jobTitle', json_object('from', target.job_title, 'to', COALESCE(NULLIF(trim(target.job_title), ''), recovered.job_title)),
          'biography', json_object('from', target.biography, 'to', COALESCE(NULLIF(trim(target.biography), ''), recovered.biography))), ?
      FROM identities target CROSS JOIN (${PROFILE_SQL}) recovered WHERE ${NEEDS_PROFILE_SQL}`)
      .bind(input.at, ...profileBindings, ...targetBindings),
    db
      .prepare(`WITH recovered AS (${PROFILE_SQL}) UPDATE identities AS target SET
      job_title = COALESCE(NULLIF(trim(target.job_title), ''), (SELECT job_title FROM recovered)),
      biography = COALESCE(NULLIF(trim(target.biography), ''), (SELECT biography FROM recovered)), updated_at = ?
      WHERE EXISTS (SELECT 1 FROM recovered WHERE ${NEEDS_PROFILE_SQL})`)
      .bind(...profileBindings, input.at, ...targetBindings),
  ];
}
