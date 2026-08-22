import { all } from "../db/queries";
import { AppError } from "../errors";
import { getActiveFormByPurpose } from "./forms";
import { buildCustomAnswerRows, buildCustomAnswerVariables } from "../utils/registration-email";
import { sha256Hex } from "../utils/crypto";
import { signAdminPreviewToken, verifyAdminPreviewToken } from "../auth/admin-preview-token";
import { parseJsonSafe, stringifyJson } from "../utils/json";
import {
  ATTENDANCE_TYPE_LABELS,
  buildAttendanceEmailData,
  buildRegistrationEmailStatusData,
} from "../utils/attendance";
import type { EventRecord } from "./events";
import type { DatabaseLike } from "../types";
import type { FormFieldDefinition } from "./forms/read";
import type { EmailMessageType } from "../../../assets/shared/schemas/admin-email-templates";
import type { AttendanceType } from "../../../assets/shared/schemas/registration";
import { adminEventCampaignPreviewSchema } from "../../../assets/shared/schemas/admin-events";
import type { z } from "zod";
import { resolveTemplate } from "../email/templates";

export type AdminCampaignInput = z.infer<typeof adminEventCampaignPreviewSchema>;

export interface CampaignRecipient {
  registrationId?: string;
  userId?: string;
  email: string;
  firstName: string;
  lastName: string;
  templateData: Record<string, unknown>;
}

export interface CampaignAudienceFilter {
  audience: "attendees" | "speakers";
  attendeeStatus?: "all" | "registered" | "pending_email_confirmation" | "cancelled";
  attendanceType?: "all" | AttendanceType;
  dayDate?: string;
  dayWaitlistStatus?: "all" | "active" | "waiting" | "offered" | "accepted" | "none";
  speakerStatus?: "all" | "confirmed" | "invited" | "pending";
}

interface AttendeeCampaignRow {
  registration_id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  status: string;
  attendance_type: string | null;
  custom_answers_json: string | null;
}

interface AttendeeDayAttendanceRow {
  registration_id: string;
  dayDate: string;
  attendanceType: string;
  label: string | null;
}

interface AttendeeDayWaitlistRow {
  registration_id: string;
  dayDate: string;
  status: string;
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

export async function listCampaignRecipients(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "slug" | "base_path" | "starts_at" | "settings_json">,
  _appBaseUrl: string,
  filter: CampaignAudienceFilter,
  options: { maxRecipients?: number } = {},
): Promise<CampaignRecipient[]> {
  const maxRecipients = Math.max(1, Math.floor(options.maxRecipients ?? 2_000));
  const fetchLimit = maxRecipients + 1;
  if (filter.audience === "attendees") {
    const form = await getActiveFormByPurpose(db, event.id, "event_registration");
    const attendeeStatus = filter.attendeeStatus ?? "registered";
    const dayWaitlistStatus = filter.dayWaitlistStatus ?? "all";
    if (filter.dayDate) {
      const rows = await all<AttendeeCampaignRow>(
        db,
        `WITH ranked_recipients AS (
           SELECT r.id AS registration_id, u.id AS user_id,
                  u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
                  r.status, r.attendance_type, r.custom_answers_json,
                  ROW_NUMBER() OVER (
                    PARTITION BY lower(trim(u.email))
                    ORDER BY datetime(r.created_at) DESC, r.id ASC
                  ) AS recipient_rank
           FROM registrations r
           JOIN users u ON u.id = r.user_id
           JOIN registration_day_attendance rda ON rda.registration_id = r.id
           JOIN event_days ed ON ed.id = rda.event_day_id
           WHERE r.event_id = ?
             AND (? = 'all' OR r.status = ?)
             AND ed.day_date = ?
             AND (? = 'all' OR rda.attendance_type = ?)
             AND u.email IS NOT NULL
             ${dayWaitlistFilterSql("day")}
         )
         SELECT registration_id, user_id, email, first_name, last_name, organization_name,
                job_title, status, attendance_type, custom_answers_json
         FROM ranked_recipients
         WHERE recipient_rank = 1
         ORDER BY lower(email) ASC
         LIMIT ?`,
        [
          event.id,
          attendeeStatus,
          attendeeStatus,
          filter.dayDate,
          filter.attendanceType ?? "all",
          filter.attendanceType ?? "all",
          ...dayWaitlistFilterParams(dayWaitlistStatus),
          fetchLimit,
        ],
      );
      assertCampaignRecipientLimit(rows, maxRecipients);
      return buildAttendeeCampaignRecipients(db, event.id, rows, form?.fields);
    }

    const rows = await all<AttendeeCampaignRow>(
      db,
      `WITH ranked_recipients AS (
         SELECT r.id AS registration_id, u.id AS user_id,
                u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
                r.status, r.attendance_type, r.custom_answers_json,
                ROW_NUMBER() OVER (
                  PARTITION BY lower(trim(u.email))
                  ORDER BY datetime(r.created_at) DESC, r.id ASC
                ) AS recipient_rank
         FROM registrations r
         JOIN users u ON u.id = r.user_id
         WHERE r.event_id = ?
           AND (? = 'all' OR r.status = ?)
           AND (? = 'all' OR r.attendance_type = ?)
           AND u.email IS NOT NULL
           ${dayWaitlistFilterSql("registration")}
       )
       SELECT registration_id, user_id, email, first_name, last_name, organization_name,
              job_title, status, attendance_type, custom_answers_json
       FROM ranked_recipients
       WHERE recipient_rank = 1
       ORDER BY lower(email) ASC
       LIMIT ?`,
      [
        event.id,
        attendeeStatus,
        attendeeStatus,
        filter.attendanceType ?? "all",
        filter.attendanceType ?? "all",
        ...dayWaitlistFilterParams(dayWaitlistStatus),
        fetchLimit,
      ],
    );

    assertCampaignRecipientLimit(rows, maxRecipients);
    return buildAttendeeCampaignRecipients(db, event.id, rows, form?.fields);
  }

  if (filter.dayDate) {
    throw new AppError(400, "CAMPAIGN_DAY_FILTER_UNSUPPORTED", "Day filter is only supported for attendee audience.");
  }

  const form = await getActiveFormByPurpose(db, event.id, "proposal_submission");
  const speakerStatus = filter.speakerStatus ?? "confirmed";
  const rows = await all<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
    speaker_status: string;
    proposal_title: string;
    proposal_abstract: string | null;
    proposal_type: string | null;
    details_json: string | null;
    proposal_updated_at: string | null;
    speaker_confirmed_at: string | null;
  }>(
    db,
    `WITH ranked_recipients AS (
       SELECT u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
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
     SELECT email, first_name, last_name, organization_name, job_title,
            speaker_status, proposal_title, proposal_abstract, proposal_type,
            details_json, proposal_updated_at, speaker_confirmed_at
     FROM ranked_recipients
     WHERE recipient_rank = 1
     ORDER BY lower(email) ASC
     LIMIT ?`,
    [event.id, speakerStatus, speakerStatus, fetchLimit],
  );

  assertCampaignRecipientLimit(rows, maxRecipients);
  return rows.map((row) => {
    const email = row.email.trim().toLowerCase();
    return {
      email,
      firstName: (row.first_name ?? "").trim(),
      lastName: (row.last_name ?? "").trim(),
      templateData: buildSpeakerTemplateData(row, form?.fields),
    };
  });
}

function assertCampaignRecipientLimit(rows: unknown[], maxRecipients: number): void {
  if (rows.length <= maxRecipients) return;
  throw new AppError(
    422,
    "CAMPAIGN_RECIPIENT_LIMIT_EXCEEDED",
    `The selected audience exceeds the configured ${maxRecipients}-recipient campaign limit. Narrow the filters and preview again.`,
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function listAttendeeDayAttendanceByRegistration(
  db: DatabaseLike,
  registrationIdsJson: string,
): Promise<Map<string, Array<{ dayDate: string; attendanceType: string; label: string | null }>>> {
  const byRegistration = new Map<string, Array<{ dayDate: string; attendanceType: string; label: string | null }>>();
  const rows = await all<AttendeeDayAttendanceRow>(
    db,
    `SELECT rda.registration_id,
            ed.day_date AS dayDate,
            rda.attendance_type AS attendanceType,
            ed.label AS label
     FROM registration_day_attendance rda
     JOIN event_days ed ON ed.id = rda.event_day_id
     WHERE rda.registration_id IN (SELECT value FROM json_each(?))
     ORDER BY rda.registration_id ASC, ed.sort_order ASC, ed.day_date ASC`,
    [registrationIdsJson],
  );
  for (const row of rows) {
    const entries = byRegistration.get(row.registration_id) ?? [];
    entries.push({
      dayDate: row.dayDate,
      attendanceType: row.attendanceType,
      label: row.label,
    });
    byRegistration.set(row.registration_id, entries);
  }

  return byRegistration;
}

async function listAttendeeDayWaitlistByRegistration(
  db: DatabaseLike,
  registrationIdsJson: string,
): Promise<Map<string, Array<{ dayDate: string; status: string }>>> {
  const byRegistration = new Map<string, Array<{ dayDate: string; status: string }>>();
  const rows = await all<AttendeeDayWaitlistRow>(
    db,
    `SELECT w.registration_id,
            ed.day_date AS dayDate,
            w.status AS status
     FROM event_day_waitlist_entries w
     JOIN event_days ed ON ed.id = w.event_day_id
     WHERE w.registration_id IN (SELECT value FROM json_each(?))
       AND w.status IN ('waiting', 'offered', 'accepted')
     ORDER BY w.registration_id ASC, ed.sort_order ASC, ed.day_date ASC`,
    [registrationIdsJson],
  );
  for (const row of rows) {
    const entries = byRegistration.get(row.registration_id) ?? [];
    entries.push({
      dayDate: row.dayDate,
      status: row.status,
    });
    byRegistration.set(row.registration_id, entries);
  }

  return byRegistration;
}

async function buildAttendeeCampaignRecipients(
  db: DatabaseLike,
  _eventId: string,
  rows: AttendeeCampaignRow[],
  formFields: FormFieldDefinition[] | undefined,
): Promise<CampaignRecipient[]> {
  if (rows.length === 0) return [];
  const registrationIdsJson = stringifyJson(rows.map((row) => row.registration_id));
  const [dayAttendanceByRegistration, dayWaitlistByRegistration] = await Promise.all([
    listAttendeeDayAttendanceByRegistration(db, registrationIdsJson),
    listAttendeeDayWaitlistByRegistration(db, registrationIdsJson),
  ]);

  return rows.map((row) => ({
    registrationId: row.registration_id,
    userId: row.user_id,
    email: row.email.trim().toLowerCase(),
    firstName: (row.first_name ?? "").trim(),
    lastName: (row.last_name ?? "").trim(),
    templateData: buildAttendeeTemplateData(
      row,
      formFields,
      undefined,
      dayAttendanceByRegistration.get(row.registration_id) ?? [],
      dayWaitlistByRegistration.get(row.registration_id) ?? [],
    ),
  }));
}

export function findBroadcastOnlyTemplateRefs(
  recipients: CampaignRecipient[],
  parts: Array<string | null | undefined>,
): string[] {
  const disallowed = new Set<string>([
    "firstName",
    "lastName",
    "email",
    "registrationStatus",
    "attendanceType",
    "speakerStatus",
    "proposalTitle",
    "proposalAbstract",
    "proposalType",
    "customAnswerRows",
    "reg_details",
    "manageUrl",
  ]);

  for (const recipient of recipients) {
    for (const key of Object.keys(recipient.templateData ?? {})) {
      if (key === "registrationUrl" || key === "proposalUrl") continue;
      disallowed.add(key);
    }
  }

  const content = parts.filter((part): part is string => Boolean(part && part.trim()));
  const found = new Set<string>();

  const regexMap = new Map<string, RegExp>();
  for (const key of disallowed) {
    if (key === "reg_details") {
      regexMap.set(key, /\{\{>\s*reg_details\s*\}\}/);
    } else {
      regexMap.set(key, new RegExp(`\\{\\{[^}]*\\b${escapeRegex(key)}\\b[^}]*\\}\\}`));
    }
  }

  for (const part of content) {
    for (const key of disallowed) {
      const regex = regexMap.get(key);
      if (regex?.test(part)) found.add(key);
    }
  }

  return Array.from(found).sort();
}

function buildAttendeeTemplateData(
  row: AttendeeCampaignRow,
  formFields: FormFieldDefinition[] | undefined,
  manageUrl?: string,
  dayAttendanceRaw: Array<{ dayDate: string; attendanceType: string; label: string | null }> = [],
  dayWaitlist: Array<{ dayDate: string; status: string }> = [],
): Record<string, unknown> {
  const customAnswers = parseJsonSafe<Record<string, unknown> | null>(row.custom_answers_json, null);
  const attendanceType = row.attendance_type ?? "";
  const attendanceData = buildAttendanceEmailData(attendanceType, dayAttendanceRaw, dayWaitlist);
  return {
    email: row.email.trim().toLowerCase(),
    organizationName: row.organization_name ?? "",
    jobTitle: row.job_title ?? "",
    ...buildRegistrationEmailStatusData(row.status, dayWaitlist),
    attendanceType,
    attendanceLabel: attendanceData.attendanceLabel || (ATTENDANCE_TYPE_LABELS[attendanceType] ?? attendanceType),
    dayAttendance: attendanceData.dayAttendance,
    dayWaitlist,
    manageUrl,
    customAnswerRows: buildCustomAnswerRows(customAnswers, formFields),
    ...buildCustomAnswerVariables(customAnswers, formFields),
  };
}

function buildSpeakerTemplateData(
  row: {
    email: string;
    organization_name?: string | null;
    job_title?: string | null;
    speaker_status: string;
    proposal_title: string;
    proposal_abstract: string | null;
    proposal_type: string | null;
    details_json: string | null;
  },
  formFields: FormFieldDefinition[] | undefined,
): Record<string, unknown> {
  const customAnswers = parseJsonSafe<Record<string, unknown> | null>(row.details_json, null);
  return {
    email: row.email.trim().toLowerCase(),
    organizationName: row.organization_name ?? "",
    jobTitle: row.job_title ?? "",
    speakerStatus: row.speaker_status,
    proposalTitle: row.proposal_title,
    proposalAbstract: row.proposal_abstract ?? "",
    proposalType: row.proposal_type ?? "",
    customAnswerRows: buildCustomAnswerRows(customAnswers, formFields),
    ...buildCustomAnswerVariables(customAnswers, formFields),
  };
}

export async function computeCampaignDigest(payload: {
  templateKey: string | undefined;
  subjectOverride?: string | null;
  customText?: string | null;
  bodyContent?: string | null;
  messageType?: EmailMessageType | null;
  sendMode: "personal" | "bcc_batch";
  batchSize: number;
  filter: CampaignAudienceFilter;
  recipients: CampaignRecipient[];
}): Promise<string> {
  const canonical = {
    templateKey: payload.templateKey,
    subjectOverride: (payload.subjectOverride ?? "").trim(),
    customText: (payload.customText ?? "").trim(),
    bodyContent: (payload.bodyContent ?? "").trim(),
    messageType: payload.messageType ?? null,
    sendMode: payload.sendMode,
    batchSize: payload.batchSize,
    filter: payload.filter,
    recipients: payload.recipients.map((r) => r.email),
  };
  return sha256Hex(JSON.stringify(canonical));
}

/** Shared D1-backed audience/template/digest preparation used by preview and send. */
export async function prepareAdminCampaign(
  db: DatabaseLike,
  event: Pick<EventRecord, "id" | "slug" | "base_path" | "starts_at" | "settings_json">,
  appBaseUrl: string,
  input: AdminCampaignInput,
  maxRecipients: number,
) {
  const template = !input.bodyContent && input.templateKey ? await resolveTemplate(db, input.templateKey) : null;
  const messageType = input.messageType ?? template?.messageType ?? "promotional";
  const filter: CampaignAudienceFilter = {
    audience: input.filter.audience,
    attendeeStatus: input.filter.attendeeStatus,
    attendanceType: input.filter.attendanceType,
    dayDate: input.filter.dayDate,
    dayWaitlistStatus: input.filter.dayWaitlistStatus,
    speakerStatus: input.filter.speakerStatus,
  };
  const recipients = await listCampaignRecipients(db, event, appBaseUrl, filter, { maxRecipients });
  const digest = await computeCampaignDigest({
    templateKey: input.templateKey,
    subjectOverride: input.subjectOverride ?? null,
    customText: input.customText ?? null,
    bodyContent: input.bodyContent ?? null,
    messageType,
    sendMode: input.sendMode,
    batchSize: input.batchSize,
    filter,
    recipients,
  });
  return { template, messageType, filter, recipients, digest };
}

export function assertCampaignBroadcastSafety(
  input: Pick<AdminCampaignInput, "sendMode" | "subjectOverride" | "bodyContent" | "customText">,
  recipients: CampaignRecipient[],
  template: { subjectTemplate: string | null; content: string } | null,
): void {
  if (input.sendMode !== "bcc_batch") return;
  const unsafeRefs = findBroadcastOnlyTemplateRefs(recipients, [
    input.subjectOverride,
    input.bodyContent,
    input.customText,
    template?.subjectTemplate,
    template?.content,
  ]);
  if (unsafeRefs.length > 0) {
    throw new AppError(
      400,
      "CAMPAIGN_BROADCAST_UNSAFE_TEMPLATE",
      `Broadcast emails cannot use recipient-specific tags: ${unsafeRefs.join(", ")}. Switch to Personal (1:1) or remove those tags.`,
    );
  }
}

export async function signCampaignPreviewToken(payload: {
  secret: string;
  eventId: string;
  adminId: string;
  digest: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: string }> {
  return signAdminPreviewToken({ ...payload, type: "admin_campaign_preview" });
}

export async function verifyCampaignPreviewToken(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  digest: string;
}): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "mismatch" }> {
  const validation = await verifyAdminPreviewToken({ ...payload, type: "admin_campaign_preview" });
  return validation.ok ? { ok: true } : validation;
}

export function chunkRecipients(recipients: CampaignRecipient[], batchSize: number): CampaignRecipient[][] {
  const size = Math.min(500, Math.max(1, Math.floor(batchSize)));
  const chunks: CampaignRecipient[][] = [];
  for (let i = 0; i < recipients.length; i += size) {
    chunks.push(recipients.slice(i, i + size));
  }
  return chunks;
}
