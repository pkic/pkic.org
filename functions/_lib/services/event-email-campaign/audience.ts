import { loadAcceptedTermsTextForRegistrations } from "../../utils/registration-email";
import { registrationPopulationFilter } from "../registrations/registration-population-filter";
import { isInvitationCampaignAudience } from "../../../../assets/shared/schemas/event-email-campaigns";
import { listInvitationCampaignRecipients } from "./invitation-audience";
import { REGISTRATION_ORGANIZATION_SQL, REGISTRATION_JOB_TITLE_SQL } from "../registrations/selected-identity";
import {
  selectedOrAffiliationJobTitleSql,
  selectedOrAffiliationOrganizationNameSql,
} from "../identities/affiliation-projection";
import { all } from "../../db/queries";
import { AppError } from "../../errors";
import { buildSpeakerTemplateData, buildAttendeeCampaignRecipients } from "./template-data";
import { projectAttendeeDayState } from "./attendance-projection";
import { resolveEventFormResponses, type EventFormResponse } from "../forms";
import type { DatabaseLike } from "../../types";
import { proposalSpeakerProfileValueSql } from "../proposal-speakers";
import { agendaDayWindow, publishedSpeakerSessionsSql } from "../event-agenda/published-speaker-sessions";
import type {
  AttendeeCampaignRow,
  CampaignAudienceFilter,
  CampaignEvent,
  CampaignRecipient,
  SpeakerCampaignRow,
} from "./types";

type AttributedAttendeeCampaignRow = AttendeeCampaignRow & { form_placement_id: string | null };
type AttributedSpeakerCampaignRow = SpeakerCampaignRow & {
  /** Null for a speaker selected from the agenda, who may have no proposal. */
  proposal_id: string | null;
  form_placement_id: string | null;
};

function campaignFormResponse(response: EventFormResponse | null) {
  return {
    answers: response?.answers ?? null,
    fields: response?.form?.fields ?? null,
  };
}

function assertCampaignRecipientLimit(rows: unknown[], maxRecipients: number): void {
  if (rows.length <= maxRecipients) return;
  throw new AppError(
    422,
    "CAMPAIGN_RECIPIENT_LIMIT_EXCEEDED",
    `The selected audience exceeds the configured ${maxRecipients}-recipient campaign limit. Narrow the filters and preview again.`,
  );
}

export function attendeeCampaignSelection(
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number | null,
  recipientEmails?: string[],
) {
  const attendeeStatus = filter.attendeeStatus ?? "registered";
  const dayWaitlistStatus = filter.dayWaitlistStatus ?? "all";
  const fetchLimit = maxRecipients === null ? -1 : maxRecipients + 1;
  const population = registrationPopulationFilter(
    event.id,
    {
      status: attendeeStatus === "all" ? undefined : attendeeStatus,
      attendance_type: filter.attendanceType === "all" ? undefined : filter.attendanceType,
      day_dates: filter.dayDate || undefined,
      waitlisted: dayWaitlistStatus === "none" ? "false" : dayWaitlistStatus === "active" ? "true" : undefined,
    },
    dayWaitlistStatus === "waiting" || dayWaitlistStatus === "offered" || dayWaitlistStatus === "accepted"
      ? dayWaitlistStatus
      : undefined,
  );

  return {
    sql: `WITH ranked_recipients AS (
           SELECT r.id AS registration_id, r.manage_link_secret, u.id AS user_id,
                  u.email, u.first_name, u.last_name, ${REGISTRATION_ORGANIZATION_SQL} AS organization_name, ${REGISTRATION_JOB_TITLE_SQL} AS job_title,
                  r.status, r.custom_answers_json, r.form_placement_id,
                  ROW_NUMBER() OVER (
                    PARTITION BY lower(trim(u.email))
                    ORDER BY datetime(r.created_at) DESC, r.id ASC
                  ) AS recipient_rank
           ${population.fromSql}
             AND u.email IS NOT NULL
             AND (? IS NULL OR lower(trim(u.email)) IN (SELECT value FROM json_each(?)))
         )
         SELECT registration_id, manage_link_secret, user_id, email, first_name, last_name, organization_name,
                job_title, status, custom_answers_json, form_placement_id
         FROM ranked_recipients
         WHERE recipient_rank = 1
         ORDER BY lower(email) ASC
         LIMIT ?`,
    bindings: [
      ...population.bindings,
      recipientEmails ? JSON.stringify(recipientEmails) : null,
      recipientEmails ? JSON.stringify(recipientEmails) : null,
      fetchLimit,
    ],
  };
}

async function listAttendeeRecipients(
  db: DatabaseLike,
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number,
  recipientEmails?: string[],
): Promise<CampaignRecipient[]> {
  const selection = attendeeCampaignSelection(event, filter, maxRecipients, recipientEmails);
  const rows = await all<AttributedAttendeeCampaignRow>(db, selection.sql, selection.bindings);

  assertCampaignRecipientLimit(rows, maxRecipients);
  const [projections, formResponses, acceptedTerms] = await Promise.all([
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
    loadAcceptedTermsTextForRegistrations(
      db,
      rows.map((row) => row.registration_id),
    ),
  ]);
  return buildAttendeeCampaignRecipients(
    rows.map((row) => ({
      ...row,
      acceptedTermsText: acceptedTerms.get(row.registration_id) ?? "",
      formResponse: campaignFormResponse(formResponses.get(row.registration_id) ?? null),
    })),
    projections,
  );
}

/** The audience's published sessions; one definition for the people and for their kits. */
export function campaignPublishedSessions(event: CampaignEvent, filter: CampaignAudienceFilter) {
  return publishedSpeakerSessionsSql(
    { sql: "?", bindings: [event.id] },
    { day: filter.dayDate ? agendaDayWindow(filter.dayDate, event.timezone) : null },
  );
}

export function speakerCampaignSelection(
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number | null,
  recipientEmails?: string[],
) {
  const speakerStatus = filter.speakerStatus ?? "confirmed";
  const sessions = campaignPublishedSessions(event, filter);
  const recipientEmailsJson = recipientEmails ? JSON.stringify(recipientEmails) : null;
  const limit = maxRecipients === null ? -1 : maxRecipients + 1;

  if (speakerStatus === "scheduled") {
    return {
      sql: `WITH ranked_recipients AS (
         SELECT NULL AS proposal_id, NULL AS form_placement_id, u.email, u.first_name, u.last_name,
                ${selectedOrAffiliationOrganizationNameSql("NULL", "session.user_id")} AS organization_name,
                ${selectedOrAffiliationJobTitleSql("NULL", "session.user_id")} AS job_title,
                'scheduled' AS speaker_status, session.session_title AS proposal_title,
                NULL AS proposal_abstract, NULL AS proposal_type, NULL AS details_json,
                NULL AS proposal_updated_at, NULL AS speaker_confirmed_at,
                ROW_NUMBER() OVER (PARTITION BY lower(trim(u.email)) ORDER BY session.occurrence_id ASC) AS recipient_rank
         FROM (${sessions.sql}) session
         JOIN users u ON u.id = session.user_id
         WHERE u.email IS NOT NULL
           AND (? IS NULL OR lower(trim(u.email)) IN (SELECT value FROM json_each(?)))
       )
       SELECT proposal_id, form_placement_id, email, first_name, last_name, organization_name, job_title,
              speaker_status, proposal_title, proposal_abstract, proposal_type,
              details_json, proposal_updated_at, speaker_confirmed_at
       FROM ranked_recipients
       WHERE recipient_rank = 1
       ORDER BY lower(email) ASC
       LIMIT ?`,
      bindings: [...sessions.bindings, recipientEmailsJson, recipientEmailsJson, limit],
    };
  }

  const onDay = filter.dayDate
    ? `AND EXISTS (SELECT 1 FROM (${sessions.sql}) session WHERE session.user_id = ps.user_id)`
    : "";

  return {
    sql: `WITH ranked_recipients AS (
       SELECT sp.id AS proposal_id, sp.form_placement_id,
              u.email,
              ${proposalSpeakerProfileValueSql("u", "ps", "firstName")} AS first_name,
              ${proposalSpeakerProfileValueSql("u", "ps", "lastName")} AS last_name,
              ${selectedOrAffiliationOrganizationNameSql("ps.acting_identity_id", "ps.user_id")} AS organization_name,
              ${selectedOrAffiliationJobTitleSql("ps.acting_identity_id", "ps.user_id")} AS job_title,
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
         ${onDay}
         AND u.email IS NOT NULL
         AND (? IS NULL OR lower(trim(u.email)) IN (SELECT value FROM json_each(?)))
     )
     SELECT proposal_id, form_placement_id, email, first_name, last_name, organization_name, job_title,
            speaker_status, proposal_title, proposal_abstract, proposal_type,
            details_json, proposal_updated_at, speaker_confirmed_at
     FROM ranked_recipients
     WHERE recipient_rank = 1
     ORDER BY lower(email) ASC
     LIMIT ?`,
    bindings: [
      event.id,
      speakerStatus,
      speakerStatus,
      ...(filter.dayDate ? sessions.bindings : []),
      recipientEmailsJson,
      recipientEmailsJson,
      limit,
    ],
  };
}

async function listSpeakerRecipients(
  db: DatabaseLike,
  event: CampaignEvent,
  filter: CampaignAudienceFilter,
  maxRecipients: number,
  recipientEmails?: string[],
): Promise<CampaignRecipient[]> {
  const selection = speakerCampaignSelection(event, filter, maxRecipients, recipientEmails);
  const rows = await all<AttributedSpeakerCampaignRow>(db, selection.sql, selection.bindings);

  assertCampaignRecipientLimit(rows, maxRecipients);
  const proposalRows = rows.flatMap((row) => (row.proposal_id ? [{ ...row, proposal_id: row.proposal_id }] : []));
  const proposalInputs = [...new Map(proposalRows.map((row) => [row.proposal_id, row])).values()];
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
      formResponse: campaignFormResponse((row.proposal_id && formResponses.get(row.proposal_id)) || null),
    }),
  }));
}

export async function listCampaignRecipients(
  db: DatabaseLike,
  event: CampaignEvent,
  _appBaseUrl: string,
  filter: CampaignAudienceFilter,
  options: { maxRecipients?: number; recipientEmails?: string[] } = {},
): Promise<CampaignRecipient[]> {
  const maxRecipients = Math.max(1, Math.floor(options.maxRecipients ?? 2_000));
  if (isInvitationCampaignAudience(filter.audience))
    return listInvitationCampaignRecipients(db, event, filter, maxRecipients, options.recipientEmails);
  return filter.audience === "attendees"
    ? listAttendeeRecipients(db, event, filter, maxRecipients, options.recipientEmails)
    : listSpeakerRecipients(db, event, filter, maxRecipients, options.recipientEmails);
}
