/** The first remaining capture is the origin; legacy leads without attempts retain theirs. */
export function activeSponsorLeadOriginSql(lead: string, field: "observed_at" | "operator_user_id") {
  return `COALESCE((SELECT current_attempt.${field} FROM event_scan_attempts current_attempt
      WHERE current_attempt.event_id=${lead}.event_id AND current_attempt.sponsor_id=${lead}.sponsor_id
      AND current_attempt.user_id=${lead}.user_id AND current_attempt.action='lead' AND current_attempt.outcome='eligible'
      ORDER BY current_attempt.observed_at,current_attempt.id LIMIT 1),${lead}.${field})`;
}
