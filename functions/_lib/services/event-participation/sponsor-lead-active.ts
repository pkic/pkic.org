/** An immutable eligible capture stops contributing once its attempt is withdrawn. */
export function activeSponsorCaptureSql(attempt: string) {
  return `NOT EXISTS (SELECT 1 FROM event_sponsor_lead_removed_attempts removed WHERE removed.attempt_id=${attempt}.id)`;
}

/** Legacy aggregate rows without attempts remain visible until a removal is recorded. */
export function activeSponsorLeadSql(lead: string) {
  return `(NOT EXISTS (SELECT 1 FROM event_sponsor_lead_removed_attempts removed WHERE removed.lead_id=${lead}.id)
    OR EXISTS (SELECT 1 FROM event_scan_attempts current_attempt WHERE current_attempt.event_id=${lead}.event_id
      AND current_attempt.sponsor_id=${lead}.sponsor_id AND current_attempt.user_id=${lead}.user_id
      AND current_attempt.action='lead' AND current_attempt.outcome='eligible'
      AND ${activeSponsorCaptureSql("current_attempt")}))`;
}

/** After any withdrawal, the first remaining capture becomes the lead's displayed origin. */
export function activeSponsorLeadOriginSql(lead: string, field: "observed_at" | "operator_user_id") {
  return `(CASE WHEN EXISTS (SELECT 1 FROM event_sponsor_lead_removed_attempts removed WHERE removed.lead_id=${lead}.id)
    THEN (SELECT current_attempt.${field} FROM event_scan_attempts current_attempt
      WHERE current_attempt.event_id=${lead}.event_id AND current_attempt.sponsor_id=${lead}.sponsor_id
      AND current_attempt.user_id=${lead}.user_id AND current_attempt.action='lead' AND current_attempt.outcome='eligible'
      AND ${activeSponsorCaptureSql("current_attempt")}
      ORDER BY current_attempt.observed_at,current_attempt.id LIMIT 1)
    ELSE ${lead}.${field} END)`;
}
