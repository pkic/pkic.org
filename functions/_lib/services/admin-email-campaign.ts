import { all } from "../db/queries";
import { AppError } from "../errors";
import { getActiveFormByPurpose } from "./forms";
import { buildCustomAnswerRows, buildCustomAnswerVariables } from "../utils/registration-email";
import { hmacSha256Hex, sha256Hex } from "../utils/crypto";
import { parseJsonSafe } from "../utils/json";
import {
  ATTENDANCE_TYPE_LABELS,
  buildAttendanceEmailData,
  buildRegistrationEmailStatusData,
} from "../utils/attendance";
import type { EventRecord } from "./events";
import type { DatabaseLike } from "../types";
import type { FormFieldDefinition } from "./forms/read";

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
  attendanceType?: "all" | "in_person" | "virtual" | "on_demand";
  dayDate?: string;
  dayWaitlistStatus?: "all" | "active" | "waiting" | "offered" | "accepted" | "none";
  speakerStatus?: "all" | "confirmed" | "invited" | "pending";
}

interface CampaignPreviewClaims {
  v: 1;
  type: "admin_campaign_preview";
  eventId: string;
  adminId: string;
  digest: string;
  exp: number;
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
  manage_token_hash: string | null;
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

function b64urlEncode(input: string): string {
  return btoa(input).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(input: string): string {
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return atob(padded);
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
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
): Promise<CampaignRecipient[]> {
  if (filter.audience === "attendees") {
    const form = await getActiveFormByPurpose(db, event.id, "event_registration");
    const attendeeStatus = filter.attendeeStatus ?? "registered";
    const dayWaitlistStatus = filter.dayWaitlistStatus ?? "all";
    if (filter.dayDate) {
      const rows = await all<AttendeeCampaignRow>(
        db,
        `SELECT DISTINCT r.id AS registration_id, u.id AS user_id,
                u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
                r.status, r.attendance_type, r.custom_answers_json, r.manage_token_hash
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
         ORDER BY lower(u.email) ASC`,
        [
          event.id,
          attendeeStatus,
          attendeeStatus,
          filter.dayDate,
          filter.attendanceType ?? "all",
          filter.attendanceType ?? "all",
          ...dayWaitlistFilterParams(dayWaitlistStatus),
        ],
      );
      return buildAttendeeCampaignRecipients(db, rows, form?.fields);
    }

    const rows = await all<AttendeeCampaignRow>(
      db,
      `SELECT DISTINCT r.id AS registration_id, u.id AS user_id,
            u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
            r.status, r.attendance_type, r.custom_answers_json, r.manage_token_hash
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ?
         AND (? = 'all' OR r.status = ?)
         AND (? = 'all' OR r.attendance_type = ?)
         AND u.email IS NOT NULL
         ${dayWaitlistFilterSql("registration")}
       ORDER BY lower(u.email) ASC`,
      [
        event.id,
        attendeeStatus,
        attendeeStatus,
        filter.attendanceType ?? "all",
        filter.attendanceType ?? "all",
        ...dayWaitlistFilterParams(dayWaitlistStatus),
      ],
    );

    return buildAttendeeCampaignRecipients(db, rows, form?.fields);
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
    `SELECT u.email, u.first_name, u.last_name, u.organization_name, u.job_title,
            ps.status AS speaker_status,
            sp.title AS proposal_title,
            sp.abstract AS proposal_abstract,
            sp.proposal_type AS proposal_type,
            sp.details_json AS details_json,
            sp.updated_at AS proposal_updated_at,
            ps.confirmed_at AS speaker_confirmed_at
     FROM proposal_speakers ps
     JOIN session_proposals sp ON sp.id = ps.proposal_id
     JOIN users u ON u.id = ps.user_id
     WHERE sp.event_id = ?
       AND ps.status != 'declined'
       AND (? = 'all' OR ps.status = ?)
       AND u.email IS NOT NULL
     ORDER BY lower(u.email) ASC,
              CASE ps.status WHEN 'confirmed' THEN 0 WHEN 'invited' THEN 1 WHEN 'pending' THEN 2 ELSE 3 END ASC,
              COALESCE(ps.confirmed_at, sp.updated_at) DESC`,
    [event.id, speakerStatus, speakerStatus],
  );

  const recipients: CampaignRecipient[] = [];
  const seenEmails = new Set<string>();
  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    if (seenEmails.has(email)) continue;
    seenEmails.add(email);
    recipients.push({
      email,
      firstName: (row.first_name ?? "").trim(),
      lastName: (row.last_name ?? "").trim(),
      templateData: buildSpeakerTemplateData(row, form?.fields),
    });
  }
  return recipients;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function chunkIds(ids: string[], size = 400): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

async function listAttendeeDayAttendanceByRegistration(
  db: DatabaseLike,
  registrationIds: string[],
): Promise<Map<string, Array<{ dayDate: string; attendanceType: string; label: string | null }>>> {
  const byRegistration = new Map<string, Array<{ dayDate: string; attendanceType: string; label: string | null }>>();
  if (registrationIds.length === 0) return byRegistration;

  for (const chunk of chunkIds(registrationIds)) {
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await all<AttendeeDayAttendanceRow>(
      db,
      `SELECT rda.registration_id,
              ed.day_date AS dayDate,
              rda.attendance_type AS attendanceType,
              ed.label AS label
       FROM registration_day_attendance rda
       JOIN event_days ed ON ed.id = rda.event_day_id
       WHERE rda.registration_id IN (${placeholders})
       ORDER BY rda.registration_id ASC, ed.sort_order ASC, ed.day_date ASC`,
      chunk,
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
  }

  return byRegistration;
}

async function listAttendeeDayWaitlistByRegistration(
  db: DatabaseLike,
  registrationIds: string[],
): Promise<Map<string, Array<{ dayDate: string; status: string }>>> {
  const byRegistration = new Map<string, Array<{ dayDate: string; status: string }>>();
  if (registrationIds.length === 0) return byRegistration;

  for (const chunk of chunkIds(registrationIds)) {
    const placeholders = chunk.map(() => "?").join(", ");
    const rows = await all<AttendeeDayWaitlistRow>(
      db,
      `SELECT w.registration_id,
              ed.day_date AS dayDate,
              w.status AS status
       FROM event_day_waitlist_entries w
       JOIN event_days ed ON ed.id = w.event_day_id
       WHERE w.registration_id IN (${placeholders})
         AND w.status IN ('waiting', 'offered', 'accepted')
       ORDER BY w.registration_id ASC, ed.sort_order ASC, ed.day_date ASC`,
      chunk,
    );
    for (const row of rows) {
      const entries = byRegistration.get(row.registration_id) ?? [];
      entries.push({
        dayDate: row.dayDate,
        status: row.status,
      });
      byRegistration.set(row.registration_id, entries);
    }
  }

  return byRegistration;
}

async function buildAttendeeCampaignRecipients(
  db: DatabaseLike,
  rows: AttendeeCampaignRow[],
  formFields: FormFieldDefinition[] | undefined,
): Promise<CampaignRecipient[]> {
  const registrationIds = Array.from(new Set(rows.map((row) => row.registration_id)));
  const [dayAttendanceByRegistration, dayWaitlistByRegistration] = await Promise.all([
    listAttendeeDayAttendanceByRegistration(db, registrationIds),
    listAttendeeDayWaitlistByRegistration(db, registrationIds),
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
  messageType?: "transactional" | "promotional" | null;
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

export async function signCampaignPreviewToken(payload: {
  secret: string;
  eventId: string;
  adminId: string;
  digest: string;
  ttlSeconds: number;
}): Promise<{ token: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + payload.ttlSeconds;
  const claims: CampaignPreviewClaims = {
    v: 1,
    type: "admin_campaign_preview",
    eventId: payload.eventId,
    adminId: payload.adminId,
    digest: payload.digest,
    exp,
  };
  const encoded = b64urlEncode(JSON.stringify(claims));
  const signature = await hmacSha256Hex(payload.secret, encoded);
  return {
    token: `${encoded}.${signature}`,
    expiresAt: new Date(exp * 1000).toISOString(),
  };
}

export async function verifyCampaignPreviewToken(payload: {
  secret: string;
  token: string;
  eventId: string;
  adminId: string;
  digest: string;
}): Promise<{ ok: true } | { ok: false; reason: "invalid" | "expired" | "mismatch" }> {
  const parts = payload.token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [encoded, signature] = parts;
  const expectedSignature = await hmacSha256Hex(payload.secret, encoded);
  if (!safeEqual(signature, expectedSignature)) return { ok: false, reason: "invalid" };

  let claims: CampaignPreviewClaims;
  try {
    claims = JSON.parse(b64urlDecode(encoded)) as CampaignPreviewClaims;
  } catch {
    return { ok: false, reason: "invalid" };
  }

  if (claims.v !== 1 || claims.type !== "admin_campaign_preview") return { ok: false, reason: "invalid" };
  if (Math.floor(Date.now() / 1000) > claims.exp) return { ok: false, reason: "expired" };
  if (claims.eventId !== payload.eventId || claims.adminId !== payload.adminId || claims.digest !== payload.digest) {
    return { ok: false, reason: "mismatch" };
  }

  return { ok: true };
}

export function chunkRecipients(recipients: CampaignRecipient[], batchSize: number): CampaignRecipient[][] {
  const size = Math.min(500, Math.max(1, Math.floor(batchSize)));
  const chunks: CampaignRecipient[][] = [];
  for (let i = 0; i < recipients.length; i += size) {
    chunks.push(recipients.slice(i, i + size));
  }
  return chunks;
}
