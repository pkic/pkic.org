import type { z } from "zod";
import {
  meetingJoinConfirmSchema,
  meetingJoinLandingSchema,
  meetingJoinResponseSchema,
} from "../../../../assets/shared/schemas/event-series";
import { all, first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike } from "../../types";
import { hmacSha256Hex, verifyHmacSha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { openProviderJoinUrl } from "./provider-url";

type JoinConfirmInput = z.infer<typeof meetingJoinConfirmSchema>;

export type MeetingJoinSubject =
  { kind: "member"; userId: string; sessionId: string } | { kind: "guest"; guestId: string; sessionId: string };

interface JoinContextRow {
  occurrence_id: string;
  series_id: string;
  event_id: string;
  event_name: string;
  starts_at: string;
  ends_at: string;
  location: string | null;
  provider_join_url_ciphertext: string | null;
  user_name: string | null;
  user_affiliation: string | null;
  guest_name: string | null;
  guest_affiliation: string | null;
}

interface TermRow {
  id: string;
  term_key: string;
  version: string;
  display_text: string | null;
  required: number;
  accepted: number;
}

const JOIN_CONTEXT_SELECT = `SELECT occurrence.id AS occurrence_id, occurrence.series_id,
  event.id AS event_id, event.name AS event_name, occurrence.starts_at, occurrence.ends_at,
  COALESCE(occurrence.location_override, series.location) AS location,
  occurrence.provider_join_url_ciphertext,
  COALESCE(user.preferred_name,
           NULLIF(trim(COALESCE(user.first_name, '') || ' ' || COALESCE(user.last_name, '')), ''),
           user.email) AS user_name,
  COALESCE(
    (SELECT GROUP_CONCAT(affiliation.name, ', ')
       FROM (
         SELECT DISTINCT organization.id, organization.name
           FROM organization_representatives representative
           JOIN members member ON member.id = representative.member_id AND member.status = 'active'
           JOIN organizations organization ON organization.id = member.organization_id
          WHERE representative.user_id = user.id AND representative.left_at IS NULL
          ORDER BY organization.name COLLATE NOCASE, organization.id
       ) affiliation),
    user.organization_name
  ) AS user_affiliation,
  guest.name AS guest_name, guest.affiliation AS guest_affiliation
  FROM event_occurrences occurrence
  JOIN event_series series ON series.id = occurrence.series_id
  JOIN events event ON event.id = series.event_id
  LEFT JOIN users user ON user.id = ?
  LEFT JOIN event_occurrence_guests guest ON guest.id = ?
  WHERE occurrence.id = ?`;

function subjectIds(subject: MeetingJoinSubject): { userId: string | null; guestId: string | null } {
  return subject.kind === "member"
    ? { userId: subject.userId, guestId: null }
    : { userId: null, guestId: subject.guestId };
}

async function loadJoinContext(
  db: DatabaseLike,
  occurrenceId: string,
  subject: MeetingJoinSubject,
): Promise<JoinContextRow> {
  const { userId, guestId } = subjectIds(subject);
  const eligible = await first<{ event_id: string }>(
    db,
    `SELECT event_id FROM current_event_occurrence_subject_eligibility
      WHERE occurrence_id = ? AND user_id IS ? AND guest_id IS ? LIMIT 1`,
    [occurrenceId, userId, guestId],
  );
  if (!eligible) {
    throw new AppError(403, "MEETING_ACCESS_REVOKED", "You are not currently eligible to join this occurrence");
  }

  const row = await first<JoinContextRow>(db, JOIN_CONTEXT_SELECT, [userId, guestId, occurrenceId]);
  if (!row || row.event_id !== eligible.event_id) {
    throw new AppError(404, "MEETING_OCCURRENCE_NOT_FOUND", "Meeting occurrence not found");
  }
  return row;
}

async function currentTerms(db: DatabaseLike, row: JoinContextRow, subject: MeetingJoinSubject): Promise<TermRow[]> {
  const { userId, guestId } = subjectIds(subject);
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
    [userId, userId, guestId, guestId, row.event_id],
  );
}

function authoritativeIdentity(row: JoinContextRow, subject: MeetingJoinSubject) {
  const name = subject.kind === "member" ? row.user_name : row.guest_name;
  const affiliation = subject.kind === "member" ? row.user_affiliation : row.guest_affiliation;
  if (!name) throw new AppError(409, "MEETING_IDENTITY_UNAVAILABLE", "The attendee identity is incomplete");
  return { name, affiliation };
}

function landingRevisionPayload(
  row: JoinContextRow,
  subject: MeetingJoinSubject,
  identity: { name: string; affiliation: string | null },
  terms: TermRow[],
): string {
  return JSON.stringify({
    occurrenceId: row.occurrence_id,
    eventId: row.event_id,
    subject:
      subject.kind === "member"
        ? { kind: subject.kind, id: subject.userId }
        : { kind: subject.kind, id: subject.guestId },
    name: identity.name,
    affiliation: identity.affiliation,
    terms: terms.map((term) => ({
      id: term.id,
      key: term.term_key,
      version: term.version,
      displayText: term.display_text ?? term.term_key,
      required: term.required === 1,
    })),
  });
}

async function buildLanding(
  db: DatabaseLike,
  occurrenceId: string,
  subject: MeetingJoinSubject,
  revisionSecret: string,
) {
  const row = await loadJoinContext(db, occurrenceId, subject);
  const terms = await currentTerms(db, row, subject);
  const identity = authoritativeIdentity(row, subject);
  const landingRevision = await hmacSha256Hex(revisionSecret, landingRevisionPayload(row, subject, identity, terms));
  return {
    row,
    terms,
    identity,
    landing: meetingJoinLandingSchema.parse({
      occurrence: {
        id: row.occurrence_id,
        seriesId: row.series_id,
        eventName: row.event_name,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        location: row.location,
      },
      ...identity,
      terms: terms.map((term) => ({
        id: term.id,
        key: term.term_key,
        version: term.version,
        displayText: term.display_text ?? term.term_key,
        required: term.required === 1,
        accepted: term.accepted === 1,
      })),
      landingRevision,
    }),
  };
}

export async function getMeetingJoinLanding(
  db: DatabaseLike,
  occurrenceId: string,
  subject: MeetingJoinSubject,
  revisionSecret: string,
) {
  return (await buildLanding(db, occurrenceId, subject, revisionSecret)).landing;
}

export async function confirmMeetingJoin(
  db: DatabaseLike,
  occurrenceId: string,
  subject: MeetingJoinSubject,
  input: JoinConfirmInput,
  options: {
    encryptionSecret: string;
    revisionSecret: string;
    evidenceSecret: string;
    ip: string | null;
    userAgent: string | null;
  },
) {
  const { row, terms, identity, landing } = await buildLanding(db, occurrenceId, subject, options.revisionSecret);
  if (
    !(await verifyHmacSha256Hex(
      options.revisionSecret,
      landingRevisionPayload(row, subject, identity, terms),
      input.landingRevision,
    )) ||
    landing.landingRevision !== input.landingRevision
  ) {
    throw new AppError(409, "MEETING_LANDING_CHANGED", "The meeting identity or terms changed; reload before joining");
  }
  if (!row.provider_join_url_ciphertext) {
    throw new AppError(409, "MEETING_PROVIDER_NOT_CONFIGURED", "This occurrence has no meeting-provider destination");
  }

  const redirectUrl = await openProviderJoinUrl(row.provider_join_url_ciphertext, options.encryptionSecret);
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
  const { userId, guestId } = subjectIds(subject);
  const [ipHash, userAgentHash] = await Promise.all([
    options.ip ? hmacSha256Hex(options.evidenceSecret, options.ip) : null,
    options.userAgent ? hmacSha256Hex(options.evidenceSecret, options.userAgent) : null,
  ]);
  const acceptanceStatements = [...supplied].map((termId) =>
    db
      .prepare(
        `INSERT OR IGNORE INTO event_access_term_acceptances
           (id, event_id, user_id, guest_id, event_term_id, accepted_at, ip_hash, user_agent_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(uuid(), row.event_id, userId, guestId, termId, now, ipHash, userAgentHash),
  );

  const proposedConfirmationId = uuid();
  const confirmationStatement =
    subject.kind === "member"
      ? db
          .prepare(
            `INSERT INTO event_occurrence_join_confirmations
               (id, occurrence_id, user_id, guest_id, name_snapshot, affiliation_snapshot,
                join_count, confirmed_at, attendance_verified_at, attendance_verification_source,
                created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?, 1, ?, NULL, NULL, ?, ?)
             ON CONFLICT(occurrence_id, user_id) WHERE user_id IS NOT NULL DO UPDATE SET
               name_snapshot = excluded.name_snapshot,
               affiliation_snapshot = excluded.affiliation_snapshot,
               join_count = event_occurrence_join_confirmations.join_count + 1,
               confirmed_at = excluded.confirmed_at,
               updated_at = excluded.updated_at`,
          )
          .bind(
            proposedConfirmationId,
            row.occurrence_id,
            subject.userId,
            identity.name,
            identity.affiliation,
            now,
            now,
            now,
          )
      : db
          .prepare(
            `INSERT INTO event_occurrence_join_confirmations
               (id, occurrence_id, user_id, guest_id, name_snapshot, affiliation_snapshot,
                join_count, confirmed_at, attendance_verified_at, attendance_verification_source,
                created_at, updated_at)
             VALUES (?, ?, NULL, ?, ?, ?, 1, ?, NULL, NULL, ?, ?)
             ON CONFLICT(occurrence_id, guest_id) WHERE guest_id IS NOT NULL DO UPDATE SET
               name_snapshot = excluded.name_snapshot,
               affiliation_snapshot = excluded.affiliation_snapshot,
               join_count = event_occurrence_join_confirmations.join_count + 1,
               confirmed_at = excluded.confirmed_at,
               updated_at = excluded.updated_at`,
          )
          .bind(
            proposedConfirmationId,
            row.occurrence_id,
            subject.guestId,
            identity.name,
            identity.affiliation,
            now,
            now,
            now,
          );

  try {
    await db.batch([
      ...acceptanceStatements,
      db
        .prepare(
          `INSERT INTO event_occurrence_join_guards
             (id, session_kind, session_id, occurrence_id, event_id, user_id, guest_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(uuid(), subject.kind, subject.sessionId, row.occurrence_id, row.event_id, userId, guestId),
      confirmationStatement,
    ]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("MEETING_JOIN_CONTEXT_CHANGED")) {
      throw new AppError(409, "MEETING_ACCESS_CHANGED", "Meeting access or the authenticated session changed");
    }
    throw error;
  }

  const persisted = await first<{ id: string; confirmed_at: string }>(
    db,
    `SELECT id, confirmed_at FROM event_occurrence_join_confirmations
      WHERE occurrence_id = ? AND user_id IS ? AND guest_id IS ?`,
    [row.occurrence_id, userId, guestId],
  );
  if (!persisted) throw new AppError(500, "MEETING_CONFIRMATION_READ_FAILED", "Failed to read meeting confirmation");
  return meetingJoinResponseSchema.parse({
    confirmationId: persisted.id,
    confirmedAt: persisted.confirmed_at,
    redirectUrl,
  });
}
