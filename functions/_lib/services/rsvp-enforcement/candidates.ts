import { RSVP_WARNING_DELAY_HOURS } from "../../../../assets/shared/constants/rsvp-enforcement";
import { all } from "../../db/queries";
import type { DatabaseLike } from "../../types";

export interface RsvpEnforcementCandidate {
  id: string;
  registration_id: string;
  manage_link_secret: string;
  event_day_id: string | null;
  response_status: "bounced" | "declined" | "tentative";
  received_at: string;
  warning_sent_at: string | null;
  event_id: string;
  user_id: string;
  source_type: string;
  source_ref: string | null;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
  day_date: string | null;
  day_label: string | null;
  day_starts_at: string | null;
  attendance_options_json: string | null;
  in_person_capacity: number | null;
  current_attendance_type: string | null;
  user_email: string;
  first_name: string | null;
  has_newer_accept: number;
}

const CANDIDATE_PROJECTION = `rsvp.id, rsvp.registration_id, r.manage_link_secret, rsvp.event_day_id, rsvp.response_status,
  rsvp.received_at, rsvp.warning_sent_at,
  r.event_id, r.user_id, r.source_type, r.source_ref,
  e.name AS event_name, e.slug AS event_slug, e.base_path AS event_base_path,
  e.starts_at AS event_starts_at, e.settings_json AS event_settings_json,
  ed.day_date, ed.label AS day_label, ed.starts_at AS day_starts_at,
  ed.attendance_options_json, ed.in_person_capacity,
  rda.attendance_type AS current_attendance_type,
  u.email AS user_email, u.first_name,
  CASE WHEN EXISTS (
    SELECT 1
    FROM calendar_rsvp_events newer
    WHERE newer.registration_id = rsvp.registration_id
      AND newer.event_day_id IS rsvp.event_day_id
      AND newer.response_status = 'accepted'
      AND (
        julianday(newer.received_at) > julianday(rsvp.received_at)
        OR (julianday(newer.received_at) = julianday(rsvp.received_at) AND newer.id > rsvp.id)
      )
  ) THEN 1 ELSE 0 END AS has_newer_accept`;

const CANDIDATE_JOINS = `JOIN registrations r ON r.id = rsvp.registration_id
  JOIN events e ON e.id = r.event_id
  JOIN users u ON u.id = r.user_id
  LEFT JOIN event_days ed ON ed.id = rsvp.event_day_id
  LEFT JOIN registration_day_attendance rda
    ON rda.registration_id = rsvp.registration_id AND rda.event_day_id = rsvp.event_day_id`;

export const RSVP_BOUNCE_DUE_QUERY = `WITH due AS (
    SELECT id
    FROM calendar_rsvp_events
    WHERE response_status = 'bounced' AND action_executed_at IS NULL
    ORDER BY received_at ASC, id ASC
    LIMIT ?
  )
  SELECT ${CANDIDATE_PROJECTION}
  FROM due
  JOIN calendar_rsvp_events rsvp ON rsvp.id = due.id
  ${CANDIDATE_JOINS}`;

export const RSVP_WARNING_DUE_QUERY = `WITH due AS (
    SELECT id
    FROM calendar_rsvp_events
    WHERE response_status IN ('declined', 'tentative')
      AND action_executed_at IS NULL
      AND warning_sent_at IS NULL
      AND received_at <= ?
    ORDER BY received_at ASC, id ASC
    LIMIT ?
  )
  SELECT ${CANDIDATE_PROJECTION}
  FROM due
  JOIN calendar_rsvp_events rsvp ON rsvp.id = due.id
  ${CANDIDATE_JOINS}`;

export const RSVP_ACTION_DUE_QUERY = `WITH due AS (
    SELECT id
    FROM calendar_rsvp_events
    WHERE response_status IN ('declined', 'tentative')
      AND action_executed_at IS NULL
      AND action_due_at IS NOT NULL
      AND action_due_at <= ?
    ORDER BY action_due_at ASC, received_at ASC, id ASC
    LIMIT ?
  )
  SELECT ${CANDIDATE_PROJECTION}
  FROM due
  JOIN calendar_rsvp_events rsvp ON rsvp.id = due.id
  ${CANDIDATE_JOINS}`;

/** Lists a bounded merge of the three independently indexed due-work paths. */
export async function listDueRsvpEnforcementCandidates(
  db: DatabaseLike,
  limit: number,
): Promise<RsvpEnforcementCandidate[]> {
  const [bounces, warnings, actions] = await Promise.all([
    all<RsvpEnforcementCandidate>(db, RSVP_BOUNCE_DUE_QUERY, [limit]),
    all<RsvpEnforcementCandidate>(db, RSVP_WARNING_DUE_QUERY, [hoursAgoIso(RSVP_WARNING_DELAY_HOURS), limit]),
    all<RsvpEnforcementCandidate>(db, RSVP_ACTION_DUE_QUERY, [new Date().toISOString(), limit]),
  ]);
  return [...bounces, ...warnings, ...actions]
    .sort((left, right) => {
      if (left.response_status === "bounced" && right.response_status !== "bounced") return -1;
      if (left.response_status !== "bounced" && right.response_status === "bounced") return 1;
      const leftTime = Date.parse(left.received_at);
      const rightTime = Date.parse(right.received_at);
      return (
        (Number.isFinite(leftTime) ? leftTime : Number.NEGATIVE_INFINITY) -
          (Number.isFinite(rightTime) ? rightTime : Number.NEGATIVE_INFINITY) || left.id.localeCompare(right.id)
      );
    })
    .slice(0, limit);
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function hoursAgoIso(hours: number): string {
  return hoursFromNow(-hours);
}

export const HAS_NEWER_ACCEPT_SQL = `SELECT 1
  FROM calendar_rsvp_events newer
  JOIN calendar_rsvp_events current ON current.id = ?
  WHERE newer.registration_id = current.registration_id
    AND newer.event_day_id IS current.event_day_id
    AND newer.response_status = 'accepted'
    AND (
      julianday(newer.received_at) > julianday(current.received_at)
      OR (julianday(newer.received_at) = julianday(current.received_at) AND newer.id > current.id)
    )`;
