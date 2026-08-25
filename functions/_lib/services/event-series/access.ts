import type { z } from "zod";
import {
  eventAccessTokenIssueSchema,
  meetingJoinConfirmSchema,
  meetingJoinLandingSchema,
  meetingJoinResponseSchema,
} from "../../../../assets/shared/schemas/event-series";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike } from "../../types";
import { hmacSha256Hex, randomToken, sha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { parseJsonSafe } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { isAuditOneChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { commitEventResourceManagementBatch } from "./management";
import { openProviderJoinUrl } from "./provider-url";
import { toEventOccurrence, type EventOccurrenceRow } from "./record";
import { getManagedSeriesOccurrence } from "./occurrences";

type AccessIssueInput = z.infer<typeof eventAccessTokenIssueSchema>;
type JoinConfirmInput = z.infer<typeof meetingJoinConfirmSchema>;

interface AccessContextRow extends EventOccurrenceRow {
  token_id: string;
  event_id: string;
  owner_group_id: string;
  registration_policy: string;
  settings_json: string;
  token_user_id: string | null;
  token_guest_id: string | null;
  token_expires_at: string;
  token_revoked_at: string | null;
  user_active: number | null;
  user_name: string | null;
  user_affiliation: string | null;
  guest_name: string | null;
  guest_affiliation: string | null;
  guest_occurrence_id: string | null;
  guest_series_id: string | null;
  guest_expires_at: string | null;
  guest_revoked_at: string | null;
}

interface TermRow {
  id: string;
  term_key: string;
  version: string;
  display_text: string | null;
  required: number;
  accepted: number;
}

const ACCESS_CONTEXT_SELECT = `token.id AS token_id, token.user_id AS token_user_id,
  token.guest_id AS token_guest_id, token.expires_at AS token_expires_at,
  token.revoked_at AS token_revoked_at,
  occurrence.id, occurrence.series_id, occurrence.starts_at, occurrence.ends_at,
  occurrence.status, COALESCE(occurrence.location_override, series.location) AS location,
  occurrence.provider_join_url_ciphertext,
  (SELECT COUNT(*) FROM event_occurrence_guests counted_guest
    WHERE counted_guest.series_id = occurrence.series_id
      AND (counted_guest.occurrence_id IS NULL OR counted_guest.occurrence_id = occurrence.id)
      AND counted_guest.revoked_at IS NULL
      AND counted_guest.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS guest_count,
  (SELECT COUNT(*) FROM event_occurrence_join_confirmations counted_confirmation
    WHERE counted_confirmation.occurrence_id = occurrence.id) AS join_confirmed_count,
  (SELECT COUNT(*) FROM event_occurrence_join_confirmations counted_confirmation
    WHERE counted_confirmation.occurrence_id = occurrence.id
      AND counted_confirmation.attendance_verified_at IS NOT NULL) AS attendance_verified_count,
  occurrence.created_at, occurrence.updated_at,
  event.id AS event_id, event.owner_group_id, event.registration_mode AS registration_policy,
  event.settings_json,
  user.active AS user_active,
  COALESCE(user.preferred_name,
           NULLIF(trim(COALESCE(user.first_name, '') || ' ' || COALESCE(user.last_name, '')), ''),
           user.email) AS user_name,
  COALESCE(
    (SELECT GROUP_CONCAT(organization.name, ', ')
       FROM organization_representatives representative
       JOIN members member ON member.id = representative.member_id AND member.status = 'active'
       JOIN organizations organization ON organization.id = member.organization_id
      WHERE representative.user_id = user.id AND representative.left_at IS NULL),
    user.organization_name
  ) AS user_affiliation,
  guest.name AS guest_name, guest.affiliation AS guest_affiliation,
  guest.occurrence_id AS guest_occurrence_id, guest.series_id AS guest_series_id,
  guest.expires_at AS guest_expires_at, guest.revoked_at AS guest_revoked_at`;

async function assertUserMayEnter(db: DatabaseLike, row: AccessContextRow, userId: string): Promise<void> {
  if (row.user_active !== 1) throw new AppError(403, "MEETING_ACCESS_REVOKED", "The user is no longer active");
  if (row.registration_policy === "required" || row.registration_policy === "public") {
    const registration = await first<{ id: string }>(
      db,
      "SELECT id FROM registrations WHERE event_id = ? AND user_id = ? AND status = 'registered'",
      [row.event_id, userId],
    );
    if (!registration) throw new AppError(403, "MEETING_REGISTRATION_REQUIRED", "An active registration is required");
    return;
  }
  const settings = parseJsonSafe<{ memberEligibility?: string }>(row.settings_json, {});
  if (settings.memberEligibility === "public") return;
  const membership = await first<{ id: string }>(
    db,
    `SELECT membership.id
       FROM group_memberships membership
      WHERE membership.user_id = ? AND membership.left_at IS NULL
        AND (
          membership.group_id = ?
          OR (
            ? = 'shared_groups' AND EXISTS (
              SELECT 1 FROM event_group_grants grant_row
               WHERE grant_row.event_id = ? AND grant_row.group_id = membership.group_id
                 AND grant_row.capability = 'attend'
            )
          )
        )
      LIMIT 1`,
    [userId, row.owner_group_id, settings.memberEligibility, row.event_id],
  );
  if (!membership) throw new AppError(403, "MEETING_GROUP_MEMBERSHIP_REQUIRED", "Active group membership is required");
}

async function loadAccessContext(db: DatabaseLike, rawToken: string): Promise<AccessContextRow> {
  const row = await first<AccessContextRow>(
    db,
    `SELECT ${ACCESS_CONTEXT_SELECT}
       FROM event_occurrence_access_tokens token
       JOIN event_occurrences occurrence ON occurrence.id = token.occurrence_id
       JOIN event_series series ON series.id = occurrence.series_id
       JOIN events event ON event.id = series.event_id
  LEFT JOIN users user ON user.id = token.user_id
  LEFT JOIN event_occurrence_guests guest ON guest.id = token.guest_id
      WHERE token.token_hash = ?`,
    [await sha256Hex(rawToken)],
  );
  const now = nowIso();
  if (!row || row.token_revoked_at || row.token_expires_at <= now) {
    throw new AppError(404, "MEETING_ACCESS_NOT_FOUND", "Meeting access link is invalid or expired");
  }
  if (row.status !== "scheduled") throw new AppError(409, "MEETING_NOT_JOINABLE", "This occurrence is not scheduled");
  if (row.token_user_id) {
    await assertUserMayEnter(db, row, row.token_user_id);
  } else if (
    !row.token_guest_id ||
    row.guest_revoked_at ||
    !row.guest_expires_at ||
    row.guest_expires_at <= now ||
    row.guest_series_id !== row.series_id ||
    (row.guest_occurrence_id !== null && row.guest_occurrence_id !== row.id)
  ) {
    throw new AppError(403, "MEETING_GUEST_ACCESS_REVOKED", "Guest access is no longer valid");
  }
  return row;
}

export async function issueOccurrenceAccessToken(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  seriesId: string,
  occurrenceId: string,
  input: AccessIssueInput,
) {
  const { context, occurrence } = await getManagedSeriesOccurrence(db, actor, groupIdOrSlug, seriesId, occurrenceId);
  const now = nowIso();
  if (input.expiresAt <= now || input.expiresAt > new Date(Date.parse(occurrence.endsAt) + 86_400_000).toISOString()) {
    throw new AppError(
      422,
      "MEETING_ACCESS_EXPIRY_INVALID",
      "Access must expire no later than one day after the occurrence",
    );
  }
  if (input.userId) {
    const user = await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ? AND active = 1", [input.userId]);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "Active user not found");
    const context = await first<AccessContextRow>(
      db,
      `SELECT ${ACCESS_CONTEXT_SELECT}
         FROM event_occurrences occurrence
         JOIN event_series series ON series.id = occurrence.series_id
         JOIN events event ON event.id = series.event_id
         JOIN users user ON user.id = ?
    LEFT JOIN event_occurrence_guests guest ON 0
    CROSS JOIN (SELECT '' AS id, ? AS user_id, NULL AS guest_id, ? AS expires_at, NULL AS revoked_at) token
        WHERE occurrence.id = ?`,
      [input.userId, input.userId, input.expiresAt, occurrenceId],
    );
    if (!context) throw new AppError(404, "EVENT_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found");
    await assertUserMayEnter(db, context, input.userId);
  } else {
    const guest = await first<{ id: string }>(
      db,
      `SELECT id FROM event_occurrence_guests
        WHERE id = ? AND series_id = ? AND (occurrence_id IS NULL OR occurrence_id = ?)
          AND revoked_at IS NULL AND expires_at > ?`,
      [input.guestId, seriesId, occurrenceId, now],
    );
    if (!guest) throw new AppError(404, "EVENT_GUEST_NOT_FOUND", "Active guest invitation not found");
  }
  const token = randomToken(32);
  const id = uuid();
  try {
    await commitEventResourceManagementBatch(db, actor, context, "manage", [
      db
        .prepare(
          `INSERT INTO event_occurrence_access_tokens
             (id, occurrence_id, user_id, guest_id, token_hash, expires_at,
              first_used_at, last_used_at, use_count, revoked_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, NULL, ?)`,
        )
        .bind(
          id,
          occurrenceId,
          input.userId ?? null,
          input.guestId ?? null,
          await sha256Hex(token),
          input.expiresAt,
          now,
        ),
      prepareScopedAuditLogAfterOneChange(
        db,
        { type: "group", id: context.groupId },
        "admin",
        actor.id,
        "event_occurrence_access_issued",
        "event_occurrence",
        occurrenceId,
        { userId: input.userId, guestId: input.guestId, expiresAt: input.expiresAt },
      ),
    ]);
  } catch (error) {
    if (isAuditOneChangeGuardFailure(error)) {
      throw new AppError(409, "MEETING_ACCESS_CHANGED", "Meeting access changed while it was being issued");
    }
    throw error;
  }
  return { token, joinPath: `/api/v1/meetings/join/${token}`, expiresAt: input.expiresAt };
}

async function currentTerms(db: DatabaseLike, row: AccessContextRow): Promise<TermRow[]> {
  return all<TermRow>(
    db,
    `SELECT term.id, term.term_key, term.version, term.display_text, term.required,
            CASE WHEN acceptance.id IS NULL THEN 0 ELSE 1 END AS accepted
       FROM event_terms term
  LEFT JOIN event_access_term_acceptances acceptance
         ON acceptance.event_term_id = term.id AND acceptance.event_id = term.event_id
        AND ((? IS NOT NULL AND acceptance.user_id = ?) OR (? IS NOT NULL AND acceptance.guest_id = ?))
      WHERE term.event_id = ? AND term.audience_type = 'attendee' AND term.active = 1
      ORDER BY term.created_at, term.id`,
    [row.token_user_id, row.token_user_id, row.token_guest_id, row.token_guest_id, row.event_id],
  );
}

export async function getMeetingJoinLanding(db: DatabaseLike, token: string) {
  const row = await loadAccessContext(db, token);
  const terms = await currentTerms(db, row);
  return meetingJoinLandingSchema.parse({
    occurrence: toEventOccurrence(row),
    name: row.token_user_id ? row.user_name : row.guest_name,
    affiliation: row.token_user_id ? row.user_affiliation : row.guest_affiliation,
    terms: terms.map((term) => ({
      id: term.id,
      key: term.term_key,
      version: term.version,
      displayText: term.display_text ?? term.term_key,
      required: term.required === 1,
      accepted: term.accepted === 1,
    })),
  });
}

export async function confirmMeetingJoin(
  db: DatabaseLike,
  token: string,
  input: JoinConfirmInput,
  options: { encryptionSecret: string; evidenceSecret: string; ip: string | null; userAgent: string | null },
) {
  const row = await loadAccessContext(db, token);
  const authoritativeName = row.token_user_id ? row.user_name : row.guest_name;
  const authoritativeAffiliation = row.token_user_id ? row.user_affiliation : row.guest_affiliation;
  if (
    !authoritativeName ||
    input.name !== authoritativeName ||
    (input.affiliation || null) !== (authoritativeAffiliation || null)
  ) {
    throw new AppError(
      409,
      "MEETING_IDENTITY_CHANGED",
      "The meeting identity or affiliation changed; reload before joining",
    );
  }
  if (!row.provider_join_url_ciphertext) {
    throw new AppError(409, "MEETING_PROVIDER_NOT_CONFIGURED", "This occurrence has no meeting-provider destination");
  }
  const redirectUrl = await openProviderJoinUrl(row.provider_join_url_ciphertext, options.encryptionSecret);
  const terms = await currentTerms(db, row);
  const currentById = new Map(terms.map((term) => [term.id, term]));
  const supplied = new Set<string>();
  for (const acceptance of input.acceptedTerms) {
    const term = currentById.get(acceptance.termId);
    if (!term || term.version !== acceptance.version) {
      throw new AppError(422, "MEETING_TERM_INVALID", "Only current meeting terms may be accepted");
    }
    supplied.add(term.id);
  }
  const missing = terms.find((term) => term.required === 1 && term.accepted !== 1 && !supplied.has(term.id));
  if (missing) throw new AppError(422, "MEETING_TERM_REQUIRED", `Acceptance is required for ${missing.term_key}`);
  const now = nowIso();
  const [ipHash, userAgentHash] = await Promise.all([
    options.ip ? hmacSha256Hex(options.evidenceSecret, options.ip) : null,
    options.userAgent ? hmacSha256Hex(options.evidenceSecret, options.userAgent) : null,
  ]);
  const existing = await first<{ id: string }>(
    db,
    `SELECT id FROM event_occurrence_join_confirmations
      WHERE occurrence_id = ? AND ((? IS NOT NULL AND user_id = ?) OR (? IS NOT NULL AND guest_id = ?))`,
    [row.id, row.token_user_id, row.token_user_id, row.token_guest_id, row.token_guest_id],
  );
  const confirmationId = existing?.id ?? uuid();
  const acceptanceStatements = [...supplied].map((termId) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO event_access_term_acceptances
           (id, event_id, user_id, guest_id, event_term_id, accepted_at, ip_hash, user_agent_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), row.event_id, row.token_user_id, row.token_guest_id, termId, now, ipHash, userAgentHash),
  );
  try {
    await db.batch([
      ...acceptanceStatements,
      db
        .prepare(
          `INSERT INTO event_occurrence_join_guards
             (id, token_id, occurrence_id, event_id, user_id, guest_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(uuid(), row.token_id, row.id, row.event_id, row.token_user_id, row.token_guest_id),
      existing
        ? db
            .prepare(
              `UPDATE event_occurrence_join_confirmations SET name_snapshot = ?, affiliation_snapshot = ?,
                 join_count = join_count + 1, confirmed_at = ?, updated_at = ? WHERE id = ?`,
            )
            .bind(authoritativeName, authoritativeAffiliation, now, now, confirmationId)
        : db
            .prepare(
              `INSERT INTO event_occurrence_join_confirmations
                 (id, occurrence_id, user_id, guest_id, name_snapshot, affiliation_snapshot,
                  join_count, confirmed_at, attendance_verified_at, attendance_verification_source,
                  created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, 1, ?, NULL, NULL, ?, ?)`,
            )
            .bind(
              confirmationId,
              row.id,
              row.token_user_id,
              row.token_guest_id,
              authoritativeName,
              authoritativeAffiliation,
              now,
              now,
              now,
            ),
      db
        .prepare(
          `UPDATE event_occurrence_access_tokens SET first_used_at = COALESCE(first_used_at, ?),
             last_used_at = ?, use_count = use_count + 1 WHERE id = ? AND revoked_at IS NULL`,
        )
        .bind(now, now, row.token_id),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("MEETING_JOIN_CONTEXT_CHANGED")) {
      throw new AppError(409, "MEETING_ACCESS_CHANGED", "Meeting access changed; reload before joining");
    }
    throw error;
  }
  return meetingJoinResponseSchema.parse({ confirmationId, confirmedAt: now, redirectUrl });
}
