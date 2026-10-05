import { agendaOccurrenceCalendarUid } from "../../../../assets/shared/event-agenda-calendar-identity";
import { prepareAuthorizationGuard, isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { instantToDateTimeLocal } from "../../../../assets/shared/timezone";
import { sessionRsvpReplySchema, sessionRsvpOutcomeSchema } from "../../../../assets/shared/schemas/event-session-rsvp";
import type { DatabaseLike, StatementLike } from "../../types";
import { first } from "../../db/queries";
import { nowIso } from "../../utils/time";
import { sha256Hex } from "../../utils/crypto";
import { AppError } from "../../errors";
import { publishedSessionsSql } from "./published-schedule";
import { sessionInvitationContextSql } from "./session-invitation-calendar";
import { setSessionParticipationFromCalendar } from "./session-booking";
interface Target {
  event_id: string;
  occurrence_id: string;
  user_id: string;
  email: string;
  revoked_at: string | null;
  active: number;
  reply_revision: number;
  reply_sequence: number;
  reply_context_json: string | null;
  live_context: string | null;
  reply_mode: "physical" | "remote";
  room_id: string | null;
  admission_policy: string | null;
  end_at: string | null;
  prior_status: string | null;
  last_claimed_reply_at: string | null;
  last_response: string | null;
  created_at: string;
}
/** Called only after the existing inbound address or HTTP transport signature verifies. */
export async function recordSessionInvitationRsvp(db: DatabaseLike, raw: unknown) {
  const input = sessionRsvpReplySchema.parse(raw);
  const target = await first<Target>(
    db,
    `SELECT invite.event_id,invite.occurrence_id,invite.user_id,person.email,person.active,invite.revoked_at,invite.reply_revision,invite.reply_sequence,invite.reply_context_json,invite.reply_mode,invite.room_id,invite.created_at,
 ${sessionInvitationContextSql} AS live_context,s.admission_policy,s.end_at,p.status AS prior_status,
 (SELECT MAX(claimed_reply_at) FROM agenda_session_rsvp_receipts receipt WHERE receipt.invitation_id=invite.id AND receipt.disposition IN ('applied','tentative')) AS last_claimed_reply_at,
 (SELECT response_status FROM agenda_session_rsvp_receipts receipt WHERE receipt.invitation_id=invite.id AND receipt.disposition IN ('applied','tentative') ORDER BY receipt.decision_revision DESC LIMIT 1) AS last_response
 FROM agenda_session_invitations invite JOIN users person ON person.id=invite.user_id LEFT JOIN (${publishedSessionsSql}) s ON s.id=invite.occurrence_id AND s.event_id=invite.event_id
 LEFT JOIN agenda_session_participations p ON p.occurrence_id=invite.occurrence_id AND p.user_id=invite.user_id WHERE invite.id=?`,
    [input.invitationId],
  );
  if (!target) return null;
  if (!target.active || target.revoked_at || target.email.toLowerCase() !== input.attendeeEmail)
    throw new AppError(
      403,
      "SESSION_RSVP_RECIPIENT_INVALID",
      "The session invitation is no longer available to this recipient.",
    );
  const hash = await sha256Hex(JSON.stringify(input));
  const prior = await first<{
    payload_hash: string;
    disposition: string;
    participation_status: string | null;
  }>(
    db,
    "SELECT payload_hash,disposition,participation_status FROM agenda_session_rsvp_receipts WHERE invitation_id=? AND provider=? AND source_message_id=?",
    [input.invitationId, input.provider, input.sourceMessageId],
  );
  if (prior) {
    if (prior.payload_hash !== hash)
      throw new AppError(
        409,
        "SESSION_RSVP_REPLAY_CONFLICT",
        "This reply identity has already been used with different content.",
      );
    return sessionRsvpOutcomeSchema.parse({
      disposition: prior.disposition,
      participationStatus: prior.participation_status,
      chronology: "server_received_order_client_clock_unverified",
    });
  }
  const now = nowIso();
  const implicit = input.icsUid === `implicit-${input.invitationId}`;
  const validUid =
    implicit ||
    input.icsUid === agendaOccurrenceCalendarUid(target.occurrence_id) ||
    input.icsUid === `${input.invitationId}@session-rsvp.pkic.org`;
  const stale =
    !validUid ||
    (input.invitationSequence !== undefined && input.invitationSequence !== target.reply_sequence) ||
    !target.reply_context_json ||
    target.live_context !== target.reply_context_json ||
    !target.end_at ||
    target.end_at <= now ||
    (input.claimedReplyAt &&
      (input.claimedReplyAt < target.created_at.slice(0, 19) + ".000Z" || input.claimedReplyAt > now)) ||
    (input.claimedReplyAt &&
      target.last_claimed_reply_at &&
      input.claimedReplyAt <= target.last_claimed_reply_at &&
      input.responseStatus !== target.last_response);
  let disposition: "applied" | "tentative" | "needs_review" | "rejected" = stale
    ? "needs_review"
    : input.responseStatus === "tentative"
      ? "tentative"
      : input.responseStatus === "bounced"
        ? "rejected"
        : "applied";
  let status = target.prior_status;
  const context = target.reply_context_json
    ? (JSON.parse(target.reply_context_json) as {
        startAt: string;
        timeZone: string;
      })
    : null;
  const date = context ? instantToDateTimeLocal(context.startAt, context.timeZone).slice(0, 10) : null;
  const eligibleRegistrationSql = `EXISTS(SELECT 1 FROM registrations reg WHERE reg.event_id=invite.event_id AND reg.user_id=invite.user_id AND reg.status='registered' AND COALESCE((SELECT attendance.attendance_type FROM registration_day_attendance attendance JOIN event_days day ON day.id=attendance.event_day_id WHERE attendance.registration_id=reg.id AND day.day_date=?),CASE WHEN EXISTS(SELECT 1 FROM event_days day WHERE day.event_id=reg.event_id AND day.day_date=?) THEN 'none' ELSE reg.attendance_type END)=?)`;
  const guard = (requireMaterial: boolean, eligibility: "required" | "invalid" | "ignore" = "required") => {
    const checkEligibility = requireMaterial && input.responseStatus === "accepted" && eligibility !== "ignore";
    return prepareAuthorizationGuard(db, {
      sql: `SELECT 1 FROM agenda_session_invitations invite JOIN users person ON person.id=invite.user_id LEFT JOIN (${publishedSessionsSql}) s ON s.id=invite.occurrence_id AND s.event_id=invite.event_id
 WHERE invite.id=? AND invite.reply_revision=? AND invite.revoked_at IS NULL AND person.active=1 AND lower(person.email)=? AND invite.reply_context_json IS ? AND invite.reply_mode=? AND invite.room_id IS ?
 ${requireMaterial ? `AND ${sessionInvitationContextSql}=invite.reply_context_json AND s.end_at>?` : ""}
 ${checkEligibility ? `AND ${eligibility === "invalid" ? "NOT" : ""} ${eligibleRegistrationSql}` : ""}`,
      bindings: [
        input.invitationId,
        target.reply_revision,
        input.attendeeEmail,
        target.reply_context_json,
        target.reply_mode,
        target.room_id,
        ...(requireMaterial ? [now] : []),
        ...(checkEligibility ? [date, date, target.reply_mode === "physical" ? "in_person" : "virtual"] : []),
      ],
    });
  };
  const finish = (): StatementLike[] => [
    db
      .prepare("UPDATE agenda_session_invitations SET reply_revision=reply_revision+1 WHERE id=? AND reply_revision=?")
      .bind(input.invitationId, target.reply_revision),
    db
      .prepare(
        `INSERT INTO agenda_session_rsvp_receipts(id,invitation_id,event_id,occurrence_id,user_id,provider,source_message_id,payload_hash,decision_revision,response_status,disposition,received_at,claimed_reply_at,invitation_sequence,participation_status,created_at)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT status FROM agenda_session_participations WHERE occurrence_id=? AND user_id=?),?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.invitationId,
        target.event_id,
        target.occurrence_id,
        target.user_id,
        input.provider,
        input.sourceMessageId,
        hash,
        target.reply_revision + 1,
        input.responseStatus,
        disposition,
        now,
        input.claimedReplyAt ?? null,
        input.invitationSequence ?? null,
        target.occurrence_id,
        target.user_id,
        now,
      ),
  ];
  try {
    if (disposition === "applied") {
      const wrapped: DatabaseLike = {
        prepare: (query) => db.prepare(query),
        batch: async (statements) => {
          const results = await db.batch([
            guard(true),
            statements[0],
            prepareAuthorizationGuard(db, { sql: "SELECT 1 WHERE changes()=1", bindings: [] }),
            ...statements.slice(1),
            ...finish(),
          ]);
          return [results[1], ...results.slice(3, 3 + statements.length - 1)];
        },
      };
      const result = await setSessionParticipationFromCalendar(
        wrapped,
        target.event_id,
        target.occurrence_id,
        target.user_id,
        {
          action:
            input.responseStatus === "declined"
              ? "cancel"
              : target.admission_policy === "preference"
                ? "save"
                : target.admission_policy === "approval"
                  ? "request"
                  : "reserve",
          attendanceMode: target.reply_mode,
          roomId: target.room_id,
        },
      );
      status = result.status;
    } else await db.batch([guard(false), ...finish()]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      const replay = await first<{
        payload_hash: string;
        disposition: string;
        participation_status: string | null;
      }>(
        db,
        "SELECT payload_hash,disposition,participation_status FROM agenda_session_rsvp_receipts WHERE invitation_id=? AND provider=? AND source_message_id=?",
        [input.invitationId, input.provider, input.sourceMessageId],
      );
      if (replay?.payload_hash === hash)
        return sessionRsvpOutcomeSchema.parse({
          disposition: replay.disposition,
          participationStatus: replay.participation_status,
          chronology: "server_received_order_client_clock_unverified",
        });
      // A definite registration refusal is a processed reply, not a transient SMTP failure.
      // The negative proof and the unchanged live recipient/material revision are atomic.
      if (input.responseStatus === "accepted") {
        disposition = "rejected";
        try {
          await db.batch([guard(true, "invalid"), ...finish()]);
          return sessionRsvpOutcomeSchema.parse({
            disposition,
            participationStatus: status,
            chronology: "server_received_order_client_clock_unverified",
          });
        } catch (refusalError) {
          if (!isAuthorizationGuardFailure(refusalError)) throw refusalError;
        }
      }
      throw new AppError(
        409,
        "SESSION_RSVP_CONTEXT_CHANGED",
        "The invitation or participation changed. Confirm your choice in the portal.",
      );
    }
    if (!(error instanceof AppError) || ![400, 403, 409].includes(error.status)) throw error;
    disposition = "rejected";
    await db.batch([guard(true, "ignore"), ...finish()]);
  }
  return sessionRsvpOutcomeSchema.parse({
    disposition,
    participationStatus: status,
    chronology: "server_received_order_client_clock_unverified",
  });
}
