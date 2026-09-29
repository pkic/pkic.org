import {
  meetingEntryPolicyFromSettings,
  type MeetingEntryPolicy,
} from "../../../../assets/shared/schemas/meeting-entry-policy";
import { personalMeetingEntryUrl } from "../../../../assets/shared/meeting-entry-navigation";
import {
  GUEST_PERSONAL_MEETING_TOKEN,
  MEMBER_PERSONAL_MEETING_TOKEN,
} from "../../../../assets/shared/meeting-personal-token";
import { base64UrlToBytes, bytesToBase64Url } from "../../auth/capability-payload";
import { newCapabilityLinkSecret } from "../../auth/capability-links";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { constantTimeEqual, hmacSha256Bytes } from "../../utils/crypto";
import { parseJsonSafe } from "../../utils/json";
import { nowIso } from "../../utils/time";

const LINK_DOMAIN = "pkic-meeting-personal-link:v2";
const USER_SECRET_PAGE = 100;

function compactUuid(id: string): string {
  const hex = id.replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(hex)) throw new Error("Invalid meeting identity ID");
  return bytesToBase64Url(Uint8Array.from(hex.match(/../g)!, (byte) => Number.parseInt(byte, 16)));
}

function expandUuid(encoded: string): string | null {
  try {
    const bytes = base64UrlToBytes(encoded);
    if (bytes.length !== 16 || bytesToBase64Url(bytes) !== encoded) return null;
    const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } catch {
    return null;
  }
}

async function linkTag(payload: string, resourceSecret: string, signingSecret: string): Promise<string> {
  const mac = await hmacSha256Bytes(signingSecret, `${LINK_DOMAIN}\0${payload}\0${resourceSecret}`);
  return bytesToBase64Url(mac.slice(0, 16));
}

function meetingUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/$/, "")}${personalMeetingEntryUrl(token)}`;
}

export async function memberPersonalMeetingUrl(
  baseUrl: string,
  link: { userId: string; seriesId: string; occurrenceId: string | null; linkSecret: string },
  signingSecret: string,
): Promise<string> {
  const payload = `m2.${compactUuid(link.userId)}.${compactUuid(link.seriesId)}.${link.occurrenceId ? compactUuid(link.occurrenceId) : "0"}`;
  return meetingUrl(baseUrl, `${payload}.${await linkTag(payload, link.linkSecret, signingSecret)}`);
}

export async function guestPersonalMeetingUrl(
  baseUrl: string,
  guestId: string,
  invitationSecret: string,
  signingSecret: string,
): Promise<string> {
  const payload = `g2.${compactUuid(guestId)}`;
  return meetingUrl(baseUrl, `${payload}.${await linkTag(payload, invitationSecret, signingSecret)}`);
}

export interface PersonalMeetingLink {
  token: string;
  series_id: string;
  occurrence_id: string | null;
  user_id: string | null;
  guest_id: string | null;
  recipient_email: string;
  invitation_version: number | null;
  /** Current per-recipient revocation secret, used only in the atomic join guard. */
  link_secret: string;
}

export async function requirePersonalMeetingLink(
  db: DatabaseLike,
  token: string,
  signingSecret: string,
): Promise<PersonalMeetingLink> {
  const member = MEMBER_PERSONAL_MEETING_TOKEN.exec(token);
  if (member) {
    const userId = expandUuid(member[1]);
    const seriesId = expandUuid(member[2]);
    const occurrenceId = member[3] === "0" ? null : expandUuid(member[3]);
    if (!userId || !seriesId || (member[3] !== "0" && !occurrenceId)) {
      throw new AppError(404, "MEETING_LINK_INVALID", "This personal meeting link is invalid");
    }
    const user = await first<{ email: string; link_secret: string | null; active: number }>(
      db,
      "SELECT email, link_secret, active FROM users WHERE id = ?",
      [userId],
    );
    const payload = token.slice(0, token.lastIndexOf("."));
    if (
      !user?.link_secret ||
      user.active !== 1 ||
      !(await constantTimeEqual(member[4], await linkTag(payload, user.link_secret, signingSecret)))
    ) {
      throw new AppError(404, "MEETING_LINK_INVALID", "This personal meeting link is invalid");
    }
    return {
      token,
      series_id: seriesId,
      occurrence_id: occurrenceId,
      user_id: userId,
      guest_id: null,
      recipient_email: user.email,
      invitation_version: null,
      link_secret: user.link_secret,
    };
  }

  const guest = GUEST_PERSONAL_MEETING_TOKEN.exec(token);
  const guestId = guest && expandUuid(guest[1]);
  if (!guest || !guestId) throw new AppError(404, "MEETING_LINK_INVALID", "This personal meeting link is invalid");
  const row = await first<{
    series_id: string;
    occurrence_id: string | null;
    normalized_email: string;
    invitation_secret: string;
    invitation_version: number;
    revoked_at: string | null;
    expires_at: string;
  }>(
    db,
    `SELECT series_id, occurrence_id, normalized_email, invitation_secret,
            invitation_version, revoked_at, expires_at
       FROM event_occurrence_guests WHERE id = ?`,
    [guestId],
  );
  const payload = token.slice(0, token.lastIndexOf("."));
  if (
    !row ||
    row.revoked_at ||
    Date.parse(row.expires_at) <= Date.now() ||
    !(await constantTimeEqual(guest[2], await linkTag(payload, row.invitation_secret, signingSecret)))
  ) {
    throw new AppError(404, "MEETING_LINK_INVALID", "This personal meeting link is invalid");
  }
  return {
    token,
    series_id: row.series_id,
    occurrence_id: row.occurrence_id,
    user_id: null,
    guest_id: guestId,
    recipient_email: row.normalized_email,
    invitation_version: row.invitation_version,
    link_secret: row.invitation_secret,
  };
}

export interface MemberLinkRecipient {
  userId: string;
  email: string;
}

function memberLinkKey(recipient: MemberLinkRecipient): string {
  return `${recipient.userId}\0${recipient.email.toLowerCase()}`;
}

/** Initialize one rotatable secret per user, never one row per meeting invite. */
async function userPersonalLinkSecrets(
  db: DatabaseLike,
  recipients: MemberLinkRecipient[],
): Promise<Map<string, string>> {
  const ids = [...new Set(recipients.map((recipient) => recipient.userId))];
  const secrets = new Map<string, string>();
  for (let offset = 0; offset < ids.length; offset += USER_SECRET_PAGE) {
    const page = ids.slice(offset, offset + USER_SECRET_PAGE);
    const rows = await all<{ id: string; link_secret: string | null }>(
      db,
      "SELECT id, link_secret FROM users WHERE id IN (SELECT value FROM json_each(?))",
      [JSON.stringify(page)],
    );
    const missing = rows.filter((row) => !row.link_secret);
    if (missing.length) {
      await db.batch(
        missing.map((row) =>
          db
            .prepare("UPDATE users SET link_secret = ? WHERE id = ? AND link_secret IS NULL")
            .bind(newCapabilityLinkSecret(), row.id),
        ),
      );
    }
    const current = missing.length
      ? await all<{ id: string; link_secret: string | null }>(
          db,
          "SELECT id, link_secret FROM users WHERE id IN (SELECT value FROM json_each(?))",
          [JSON.stringify(page)],
        )
      : rows;
    for (const row of current) if (row.link_secret) secrets.set(row.id, row.link_secret);
  }
  return secrets;
}

export async function memberMeetingLinkUrls(
  db: DatabaseLike,
  seriesId: string,
  occurrenceId: string | null,
  recipients: MemberLinkRecipient[],
  appBaseUrl: string,
  signingSecret: string,
): Promise<Map<string, string>> {
  const secrets = await userPersonalLinkSecrets(db, recipients);
  const urls = new Map<string, string>();
  await Promise.all(
    recipients.map(async (recipient) => {
      const linkSecret = secrets.get(recipient.userId);
      if (!linkSecret) throw new AppError(409, "MEETING_RECIPIENT_UNAVAILABLE", "Meeting recipient is unavailable");
      urls.set(
        memberLinkKey(recipient),
        await memberPersonalMeetingUrl(
          appBaseUrl,
          { userId: recipient.userId, seriesId, occurrenceId, linkSecret },
          signingSecret,
        ),
      );
    }),
  );
  return urls;
}

/** Reuse the same per-user secrets for every occurrence in a cancellation batch. */
export async function memberMeetingOccurrenceLinkUrls(
  db: DatabaseLike,
  seriesId: string,
  recipients: Array<MemberLinkRecipient & { occurrenceId: string }>,
  appBaseUrl: string,
  signingSecret: string,
): Promise<Map<string, string>> {
  const secrets = await userPersonalLinkSecrets(db, recipients);
  const urls = new Map<string, string>();
  await Promise.all(
    recipients.map(async (recipient) => {
      const linkSecret = secrets.get(recipient.userId);
      if (!linkSecret) throw new AppError(409, "MEETING_RECIPIENT_UNAVAILABLE", "Meeting recipient is unavailable");
      urls.set(
        `${recipient.occurrenceId}\0${memberLinkKey(recipient)}`,
        await memberPersonalMeetingUrl(
          appBaseUrl,
          { userId: recipient.userId, seriesId, occurrenceId: recipient.occurrenceId, linkSecret },
          signingSecret,
        ),
      );
    }),
  );
  return urls;
}

export function memberMeetingLinkUrl(links: Map<string, string>, userId: string, email: string): string {
  const url = links.get(memberLinkKey({ userId, email }));
  if (!url) throw new AppError(500, "MEETING_LINK_MISSING", "Personal meeting link was not prepared");
  return url;
}

interface PersonalMeetingTargetRow {
  occurrence_id: string;
  event_name: string;
  starts_at: string;
  name: string;
  settings_json: string;
}

export async function requirePersonalMeetingTarget(
  db: DatabaseLike,
  link: PersonalMeetingLink,
  requestedOccurrenceId?: string,
): Promise<{
  occurrenceId: string;
  seriesId: string;
  eventName: string;
  startsAt: string;
  name: string;
  policy: MeetingEntryPolicy;
}> {
  const row = await first<PersonalMeetingTargetRow>(
    db,
    `SELECT occurrence.id AS occurrence_id, event.name AS event_name, occurrence.starts_at,
      CASE WHEN ? IS NOT NULL THEN
        COALESCE(NULLIF(user.preferred_name, ''),
          NULLIF(trim(COALESCE(user.first_name, '') || ' ' || COALESCE(user.last_name, '')), ''), user.email)
        ELSE guest.name END AS name,
      event.settings_json
     FROM event_series series
     JOIN events event ON event.id = series.event_id
     JOIN event_occurrences occurrence ON occurrence.series_id = series.id
       AND occurrence.status = 'scheduled'
     LEFT JOIN users user ON user.id = ?
     LEFT JOIN event_occurrence_guests guest ON guest.id = ?
     WHERE series.id = ? AND series.active = 1
       AND (? IS NULL OR occurrence.id = ?)
       AND (? IS NULL OR occurrence.id = ?)
       AND occurrence.ends_at > ?
       AND (? IS NULL OR user.active = 1)
       AND (? IS NULL OR
         (guest.invitation_version = ? AND guest.revoked_at IS NULL
          AND unixepoch(guest.expires_at) > unixepoch()))
       AND EXISTS (
         SELECT 1 FROM current_event_occurrence_subject_eligibility eligible
          WHERE eligible.occurrence_id = occurrence.id
            AND eligible.user_id IS ? AND eligible.guest_id IS ?
       )
     ORDER BY occurrence.starts_at, occurrence.id LIMIT 1`,
    [
      link.user_id,
      link.user_id,
      link.guest_id,
      link.series_id,
      link.occurrence_id,
      link.occurrence_id,
      requestedOccurrenceId ?? null,
      requestedOccurrenceId ?? null,
      nowIso(),
      link.user_id,
      link.guest_id,
      link.invitation_version,
      link.user_id,
      link.guest_id,
    ],
  );
  if (!row)
    throw new AppError(404, "MEETING_LINK_UNAVAILABLE", "No eligible upcoming meeting is available for this link");
  return {
    occurrenceId: row.occurrence_id,
    seriesId: link.series_id,
    eventName: row.event_name,
    startsAt: row.starts_at,
    name: row.name,
    policy: meetingEntryPolicyFromSettings(parseJsonSafe(row.settings_json, {})),
  };
}
