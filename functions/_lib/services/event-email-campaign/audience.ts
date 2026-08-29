import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { buildSpeakerTemplateData, buildAttendeeCampaignRecipients } from "./template-data";
import { projectAttendeeDayState } from "./attendance-projection";
import { resolveEventFormResponses, type EventFormResponse } from "../forms";
import type { DatabaseLike } from "../../types";
import { proposalSpeakerEffectiveProfileExpression } from "../proposal-speakers";
import type {
  AttendeeCampaignRow,
  CampaignAudienceFilter,
  CampaignEvent,
  CampaignRecipient,
  SpeakerCampaignRow,
} from "./types";

type AttributedAttendeeCampaignRow = AttendeeCampaignRow & { form_placement_id: string | null };
type AttributedSpeakerCampaignRow = SpeakerCampaignRow & { proposal_id: string; form_placement_id: string | null };

function campaignFormResponse(response: EventFormResponse | null) {
  return {
    answers: response?.answers ?? null,
    fields: response?.form?.fields ?? null,
  };
}

function dayWaitlistFilterSql(scope: "registration" | "day"): string {
  const dayClause = scope === "day" ? " AND w.event_day_id = ed.id" : "";
  return `AND (
           ? = 'all'
           OR (? = 'none' AND NOT EXISTS (
             SELECT 1 FROM event_day_waitlist_entries w
             WHERE w.registration_id = r.id
               AND w.status IN ('waiting', 'offered', 'accepted')${dayClause}
           ))
           OR (? = 'active' AND EXISTS (
             SELECT 1 FROM event_day_waitlist_entries w
             WHERE w.registration_id = r.id
               AND w.status IN ('waiting', 'offered')${dayClause}
           ))
           OR (? IN ('waiting', 'offered', 'accepted') AND EXISTS (
             SELECT 1 FROM event_day_waitlist_entries w
             WHERE w.registration_id = r.id
               AND w.status = ?${dayClause}
           ))
         )`;
}

function dayWaitlistFilterParams(status: CampaignAudienceFilter["dayWaitlistStatus"]): string[] {
  const normalized = status ?? "all";
  return [normalized, normalized, normalized, normalized, normalized];
}

function assertCampaignRecipientLimit(rows: unknown[], maxRecipients: number): void {
  if (rows.length <= maxRecipients) return;
  throw new AppError(
    422,
    "CAMPAIGN_RECIPIENT_LIMIT_EXCEEDED",
    `The selected audience exceeds the configured ${maxRecipients}-recipient campaign limit. Narrow the filters and preview again.`,
  );
}

async function listAttendeeRecipients(
  db: DatabaseLike,
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number,
): Promise<CampaignRecipient[]> {
  const attendeeStatus = filter.attendeeStatus ?? "registered";
  const dayWaitlistStatus = filter.dayWaitlistStatus ?? "all";
  const fetchLimit = maxRecipients + 1;
  const dayFilter = filter.dayDate ? "AND ed.day_date = ?" : "";
  const dayJoin = filter.dayDate
    ? "JOIN registration_day_attendance rda ON rda.registration_id = r.id JOIN event_days ed ON ed.id = rda.event_day_id"
    : "";
  const attendanceFilter = filter.dayDate
    ? "AND (? = 'all' OR rda.attendance_type = ?)"
    : "AND (? = 'all' OR r.attendance_type = ?)";
  const rows = await all<AttributedAttendeeCampaignRow>(
    db,
    `WITH ranked_recipients AS (
           SELECT r.id AS registration_id, r.manage_link_secret, u.id AS user_id,
                  u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
                  r.status, r.attendance_type, r.custom_answers_json, r.form_placement_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY lower(trim(u.email))
                    ORDER BY datetime(r.created_at) DESC, r.id ASC
                  ) AS recipient_rank
           FROM registrations r
           JOIN users u ON u.id = r.user_id
           ${dayJoin}
           WHERE r.event_id = ?
             AND (? = 'all' OR r.status = ?)
             ${dayFilter}
             ${attendanceFilter}
             AND u.email IS NOT NULL
             ${dayWaitlistFilterSql(filter.dayDate ? "day" : "registration")}
         )
         SELECT registration_id, manage_link_secret, user_id, email, first_name, last_name, organization_name,
                job_title, status, attendance_type, custom_answers_json, form_placement_id
         FROM ranked_recipients
         WHERE recipient_rank = 1
         ORDER BY lower(email) ASC
         LIMIT ?`,
    [
      event.id,
      attendeeStatus,
      attendeeStatus,
      ...(filter.dayDate ? [filter.dayDate] : []),
      filter.attendanceType ?? "all",
      filter.attendanceType ?? "all",
      ...dayWaitlistFilterParams(dayWaitlistStatus),
      fetchLimit,
    ],
  );

  assertCampaignRecipientLimit(rows, maxRecipients);
  const [projections, formResponses] = await Promise.all([
    projectAttendeeDayState(
      db,
      rows.map((row) => row.registration_id),
    ),
    resolveEventFormResponses(
      db,
      rows.map((row) => ({
        source: "registration" as const,
        sourceId: row.registration_id,
        event: { id: event.id, source_mode: event.source_mode ?? null },
        formPlacementId: row.form_placement_id,
        answersJson: row.custom_answers_json,
      })),
    ),
  ]);
  return buildAttendeeCampaignRecipients(
    rows.map((row) => ({ ...row, formResponse: campaignFormResponse(formResponses.get(row.registration_id) ?? null) })),
    projections,
  );
}

async function listSpeakerRecipients(
  db: DatabaseLike,
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number,
): Promise<CampaignRecipient[]> {
  if (filter.dayDate) {
    throw new AppError(400, "CAMPAIGN_DAY_FILTER_UNSUPPORTED", "Day filter is only supported for attendee audience.");
  }

  const speakerStatus = filter.speakerStatus ?? "confirmed";
  const rows = await all<AttributedSpeakerCampaignRow>(
    db,
    `WITH ranked_recipients AS (
       SELECT sp.id AS proposal_id, sp.form_placement_id,
              u.email,
              ${proposalSpeakerEffectiveProfileExpression("u", "ps", "firstName", "first_name")} AS first_name,
              ${proposalSpeakerEffectiveProfileExpression("u", "ps", "lastName", "last_name")} AS last_name,
              ${proposalSpeakerEffectiveProfileExpression("u", "ps", "organizationName", "organization_name")} AS organization_name,
              ${proposalSpeakerEffectiveProfileExpression("u", "ps", "jobTitle", "job_title")} AS job_title,
              ps.status AS speaker_status,
              sp.title AS proposal_title,
              sp.abstract AS proposal_abstract,
              sp.proposal_type AS proposal_type,
              sp.details_json AS details_json,
              sp.updated_at AS proposal_updated_at,
              ps.confirmed_at AS speaker_confirmed_at,
              ROW_NUMBER() OVER (
                PARTITION BY lower(trim(u.email))
                ORDER BY
                  CASE ps.status WHEN 'confirmed' THEN 0 WHEN 'invited' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END ASC,
                  datetime(COALESCE(ps.confirmed_at, sp.updated_at)) DESC,
                  ps.proposal_id ASC
              ) AS recipient_rank
       FROM proposal_speakers ps
       JOIN session_proposals sp ON sp.id = ps.proposal_id
       JOIN users u ON u.id = ps.user_id
       WHERE sp.event_id = ?
         AND ps.status != 'declined'
         AND (? = 'all' OR ps.status = ?)
         AND u.email IS NOT NULL
     )
     SELECT proposal_id, form_placement_id, email, first_name, last_name, organization_name, job_title,
            speaker_status, proposal_title, proposal_abstract, proposal_type,
            details_json, proposal_updated_at, speaker_confirmed_at
     FROM ranked_recipients
     WHERE recipient_rank = 1
     ORDER BY lower(email) ASC
     LIMIT ?`,
    [event.id, speakerStatus, speakerStatus, maxRecipients + 1],
  );

  assertCampaignRecipientLimit(rows, maxRecipients);
  const proposalInputs = [...new Map(rows.map((row) => [row.proposal_id, row])).values()];
  const formResponses = await resolveEventFormResponses(
    db,
    proposalInputs.map((row) => ({
      source: "proposal" as const,
      sourceId: row.proposal_id,
      event: { id: event.id, source_mode: event.source_mode ?? null },
      formPlacementId: row.form_placement_id,
      answersJson: row.details_json,
    })),
  );
  return rows.map((row) => ({
    email: row.email.trim().toLowerCase(),
    firstName: (row.first_name ?? "").trim(),
    lastName: (row.last_name ?? "").trim(),
    templateData: buildSpeakerTemplateData({
      ...row,
      formResponse: campaignFormResponse(formResponses.get(row.proposal_id) ?? null),
    }),
  }));
}

export async function listCampaignRecipients(
  db: DatabaseLike,
  event: CampaignEvent,
  _appBaseUrl: string,
  filter: CampaignAudienceFilter,
  options: { maxRecipients?: number } = {},
): Promise<CampaignRecipient[]> {
  const maxRecipients = Math.max(1, Math.floor(options.maxRecipients ?? 2_000));
  return filter.audience === "attendees"
    ? listAttendeeRecipients(db, event, filter, maxRecipients)
    : listSpeakerRecipients(db, event, filter, maxRecipients);
}
