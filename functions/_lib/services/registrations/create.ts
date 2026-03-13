import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { randomToken, sha256Hex } from "../../utils/crypto";
import { uuid } from "../../utils/ids";
import { nowIso, addHours } from "../../utils/time";
import { addToWaitlist } from "./waitlist";
import { recordReferralConversion } from "../referrals";
import { recordEngagement } from "../engagement";
import { deriveEventAttendanceType, replaceRegistrationDayAttendance, type DayAttendanceSelection } from "../event-days";
import { roleBasedCapacityExemptReason, syncRegistrationDayWaitlist } from "./day-waitlist";
import { upsertAttendeeParticipant } from "./participant-registration";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

async function initialRegistrationStatus(
  db: DatabaseLike,
  eventId: string,
  attendanceType: "in_person" | "virtual" | "on_demand",
  inviteId: string | null,
  hasPerDayAttendance: boolean,
  capacityExempt: boolean,
): Promise<"pending_email_confirmation" | "registered" | "waitlisted"> {
  if (!inviteId) {
    return "pending_email_confirmation";
  }
  if (hasPerDayAttendance || capacityExempt) {
    return "registered";
  }
  if (attendanceType !== "in_person") {
    return "registered";
  }
  // Event-level capacity is deprecated; only per-day capacities are enforced.
  void db;
  void eventId;
  return "registered";
}

export async function createRegistration(
  db: DatabaseLike,
  payload: {
    event: { id: string };
    userId: string;
    attendanceType: "in_person" | "virtual" | "on_demand";
    dayAttendance?: DayAttendanceSelection[];
    sourceType: string;
    sourceRef?: string | null;
    customAnswersJson?: string | null;
    inviteId?: string | null;
    referredByCode?: string | null;
    confirmationTtlHours: number;
  },
): Promise<{ registration: RegistrationRecord; manageToken: string; confirmationToken: string | null }> {
  const existing = await first<RegistrationRecord>(
    db,
    "SELECT * FROM registrations WHERE event_id = ? AND user_id = ?",
    [payload.event.id, payload.userId],
  );
  if (existing) {
    throw new AppError(409, "REGISTRATION_EXISTS", "This user is already registered for the event");
  }
  const now = nowIso();
  const manageToken = randomToken(24);
  const manageHash = await sha256Hex(manageToken);
  const hasPerDayAttendance = Boolean(payload.dayAttendance && payload.dayAttendance.length > 0);
  const attendanceType = deriveEventAttendanceType(payload.dayAttendance) ?? payload.attendanceType;
  const roleExemptReason = await roleBasedCapacityExemptReason(db, payload.event.id, payload.userId);
  const capacityExemptReason = roleExemptReason;
  const capacityExempt = Boolean(capacityExemptReason);
  const status = await initialRegistrationStatus(
    db,
    payload.event.id,
    attendanceType,
    payload.inviteId ?? null,
    hasPerDayAttendance,
    capacityExempt,
  );
  let confirmationToken: string | null = null;
  let confirmationHash: string | null = null;
  let confirmationExpiresAt: string | null = null;
  if (status === "pending_email_confirmation") {
    confirmationToken = randomToken(24);
    confirmationHash = await sha256Hex(confirmationToken);
    confirmationExpiresAt = addHours(now, payload.confirmationTtlHours);
  }
  const registration: RegistrationRecord = {
    id: uuid(),
    event_id: payload.event.id,
    user_id: payload.userId,
    invite_id: payload.inviteId ?? null,
    status,
    attendance_type: attendanceType,
    source_type: payload.sourceType,
    source_ref: payload.sourceRef ?? null,
    custom_answers_json: payload.customAnswersJson ?? null,
    referred_by_code: payload.referredByCode ?? null,
    confirmation_token_hash: confirmationHash,
    confirmation_token_expires_at: confirmationExpiresAt,
    manage_token_hash: manageHash,
    capacity_exempt_in_person: capacityExempt ? 1 : 0,
    capacity_exempt_reason: capacityExemptReason,
    confirmed_at: status === "registered" ? now : null,
    cancelled_at: null,
    created_at: now,
    updated_at: now,
  };
  await run(
    db,
    `INSERT INTO registrations (
      id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
      custom_answers_json, referred_by_code, confirmation_token_hash, confirmation_token_expires_at,
      manage_token_hash, capacity_exempt_in_person, capacity_exempt_reason,
      confirmed_at, cancelled_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      registration.id,
      registration.event_id,
      registration.user_id,
      registration.invite_id,
      registration.status,
      registration.attendance_type,
      registration.source_type,
      registration.source_ref,
      registration.custom_answers_json,
      registration.referred_by_code,
      registration.confirmation_token_hash,
      registration.confirmation_token_expires_at,
      registration.manage_token_hash,
      registration.capacity_exempt_in_person,
      registration.capacity_exempt_reason,
      registration.confirmed_at,
      registration.cancelled_at,
      registration.created_at,
      registration.updated_at,
    ],
  );
  await replaceRegistrationDayAttendance(db, {
    registrationId: registration.id,
    eventId: registration.event_id,
    selections: payload.dayAttendance,
  });
  await syncRegistrationDayWaitlist(db, {
    registrationId: registration.id,
    eventId: registration.event_id,
    userId: registration.user_id,
    selections: payload.dayAttendance,
    capacityExemptReason,
  });
  await upsertAttendeeParticipant(db, registration);
  await recordEngagement(db, {
    userId: registration.user_id,
    eventId: registration.event_id,
    subjectType: "registration",
    subjectRef: registration.id,
    actionType: "registration_created",
    points: 2,
    sourceType: "registration",
    sourceRef: registration.id,
    data: { status: registration.status, attendanceType: registration.attendance_type },
  });
  await run(
    db,
    `INSERT INTO registration_attendance_history (
      id, registration_id, from_type, to_type, changed_by, changed_at
    ) VALUES (?, ?, ?, ?, ?, ?)`,
    [uuid(), registration.id, null, registration.attendance_type, "system", now],
  );
  if (status === "waitlisted") {
    await addToWaitlist(db, payload.event.id, registration.id);
  }
  if (payload.referredByCode) {
    await recordReferralConversion(db, payload.referredByCode);
  }
  return { registration, manageToken, confirmationToken };
}
