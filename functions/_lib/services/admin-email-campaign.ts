import { all } from "../db/queries";
import { AppError } from "../errors";
import { getActiveFormByPurpose } from "./forms";
import { buildCustomAnswerRows, buildCustomAnswerVariables } from "../utils/registration-email";
import { hmacSha256Hex, sha256Hex } from "../utils/crypto";
import { parseJsonSafe } from "../utils/json";
import type { DatabaseLike } from "../types";
import type { FormFieldDefinition } from "./forms/read";

export interface CampaignRecipient {
  email: string;
  firstName: string;
  lastName: string;
  templateData: Record<string, unknown>;
}

export interface CampaignAudienceFilter {
  audience: "attendees" | "speakers";
  attendeeStatus?: "all" | "registered" | "pending_email_confirmation" | "waitlisted" | "cancelled";
  attendanceType?: "all" | "in_person" | "virtual" | "on_demand";
  dayDate?: string;
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

export async function listCampaignRecipients(
  db: DatabaseLike,
  eventId: string,
  filter: CampaignAudienceFilter,
): Promise<CampaignRecipient[]> {
  if (filter.audience === "attendees") {
    const form = await getActiveFormByPurpose(db, eventId, "event_registration");
    const attendeeStatus = filter.attendeeStatus ?? "registered";
    if (filter.dayDate) {
      const rows = await all<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        status: string;
        attendance_type: string | null;
        custom_answers_json: string | null;
      }>(
        db,
        `SELECT DISTINCT u.email, u.first_name, u.last_name, r.status, r.attendance_type, r.custom_answers_json
         FROM registrations r
         JOIN users u ON u.id = r.user_id
         JOIN registration_day_attendance rda ON rda.registration_id = r.id
         JOIN event_days ed ON ed.id = rda.event_day_id
         WHERE r.event_id = ?
           AND (? = 'all' OR r.status = ?)
           AND ed.day_date = ?
           AND (? = 'all' OR rda.attendance_type = ?)
           AND u.email IS NOT NULL
         ORDER BY lower(u.email) ASC`,
        [eventId, attendeeStatus, attendeeStatus, filter.dayDate, filter.attendanceType ?? "all", filter.attendanceType ?? "all"],
      );
      return rows.map((row) => ({
        email: row.email.trim().toLowerCase(),
        firstName: (row.first_name ?? "").trim(),
        lastName: (row.last_name ?? "").trim(),
        templateData: buildAttendeeTemplateData(row, form?.fields),
      }));
    }

    const rows = await all<{
      email: string;
      first_name: string | null;
      last_name: string | null;
      status: string;
      attendance_type: string | null;
      custom_answers_json: string | null;
    }>(
      db,
      `SELECT DISTINCT u.email, u.first_name, u.last_name, r.status, r.attendance_type, r.custom_answers_json
       FROM registrations r
       JOIN users u ON u.id = r.user_id
       WHERE r.event_id = ?
         AND (? = 'all' OR r.status = ?)
         AND (? = 'all' OR r.attendance_type = ?)
         AND u.email IS NOT NULL
       ORDER BY lower(u.email) ASC`,
      [eventId, attendeeStatus, attendeeStatus, filter.attendanceType ?? "all", filter.attendanceType ?? "all"],
    );

    return rows.map((row) => ({
      email: row.email.trim().toLowerCase(),
      firstName: (row.first_name ?? "").trim(),
      lastName: (row.last_name ?? "").trim(),
      templateData: buildAttendeeTemplateData(row, form?.fields),
    }));
  }

  if (filter.dayDate) {
    throw new AppError(400, "CAMPAIGN_DAY_FILTER_UNSUPPORTED", "Day filter is only supported for attendee audience.");
  }

  const form = await getActiveFormByPurpose(db, eventId, "proposal_submission");
  const speakerStatus = filter.speakerStatus ?? "confirmed";
  const rows = await all<{
    email: string;
    first_name: string | null;
    last_name: string | null;
    speaker_status: string;
    proposal_title: string;
    proposal_abstract: string | null;
    proposal_type: string | null;
    details_json: string | null;
    proposal_updated_at: string | null;
    speaker_confirmed_at: string | null;
  }>(
    db,
    `SELECT u.email, u.first_name, u.last_name,
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
    [eventId, speakerStatus, speakerStatus],
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

function templateReferencesKey(template: string, key: string): boolean {
  const pattern = new RegExp(`\\{\\{[^}]*\\b${escapeRegex(key)}\\b[^}]*\\}\\}`);
  return pattern.test(template);
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
  ]);

  for (const recipient of recipients) {
    for (const key of Object.keys(recipient.templateData ?? {})) {
      if (key === "registrationUrl" || key === "proposalUrl") continue;
      disallowed.add(key);
    }
  }

  const content = parts.filter((part): part is string => Boolean(part && part.trim()));
  const found = new Set<string>();

  for (const part of content) {
    for (const key of disallowed) {
      if (key === "reg_details") {
        if (/\{\{>\s*reg_details\s*\}\}/.test(part)) found.add(key);
        continue;
      }
      if (templateReferencesKey(part, key)) found.add(key);
    }
  }

  return Array.from(found).sort();
}

function buildAttendeeTemplateData(
  row: {
    email: string;
    status: string;
    attendance_type: string | null;
    custom_answers_json: string | null;
  },
  formFields: FormFieldDefinition[] | undefined,
): Record<string, unknown> {
  const customAnswers = parseJsonSafe<Record<string, unknown> | null>(row.custom_answers_json, null);
  return {
    email: row.email.trim().toLowerCase(),
    registrationStatus: row.status,
    attendanceType: row.attendance_type ?? "",
    customAnswerRows: buildCustomAnswerRows(customAnswers, formFields),
    ...buildCustomAnswerVariables(customAnswers, formFields),
  };
}

function buildSpeakerTemplateData(
  row: {
    email: string;
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
