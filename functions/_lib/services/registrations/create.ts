import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { uuid } from "../../utils/ids";
import { nowIso, addHours } from "../../utils/time";
import { recordReferralConversion } from "../referrals";
import { recordEngagement } from "../engagement";
import {
  deriveEventAttendanceType,
  replaceRegistrationDayAttendance,
  type DayAttendanceSelection,
} from "../event-days";
import { roleBasedCapacityExemptReason, syncRegistrationDayWaitlist } from "./day-waitlist";
import { upsertAttendeeParticipant } from "./participant-registration";
import { newCapabilityLinkSecret, signedOrQueuedCapability } from "../capability-links";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

const DEFAULT_PENDING_CONFIRMATION_DEADLINE_HOURS = 14 * 24;

async function initialRegistrationStatus(
  inviteId: string | null,
): Promise<"pending_email_confirmation" | "registered"> {
  if (!inviteId) {
    return "pending_email_confirmation";
  }
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
    pendingConfirmationDeadlineHours?: number;
    confirmationTtlHours?: number;
    signingSecret?: string;
  },
): Promise<{
  registration: RegistrationRecord;
  manageToken: string;
  confirmationToken: string | null;
  reactivated: boolean;
}> {
  const existing = await first<RegistrationRecord>(
    db,
    "SELECT * FROM registrations WHERE event_id = ? AND user_id = ?",
    [payload.event.id, payload.userId],
  );
  if (existing) {
    if (existing.status !== "cancelled") {
      throw new AppError(409, "REGISTRATION_EXISTS", "This user is already registered for the event");
    }
  }
  const now = nowIso();
  const registrationId = existing?.id ?? uuid();
  const manageLinkSecret = newCapabilityLinkSecret();
  const attendanceType = deriveEventAttendanceType(payload.dayAttendance) ?? payload.attendanceType;
  const roleExemptReason = await roleBasedCapacityExemptReason(db, payload.event.id, payload.userId);
  const capacityExemptReason = roleExemptReason;
  const capacityExempt = Boolean(capacityExemptReason);
  const status = await initialRegistrationStatus(payload.inviteId ?? null);
  let confirmationLinkSecret: string | null = null;
  let pendingConfirmationDeadlineAt: string | null = null;
  if (status === "pending_email_confirmation") {
    confirmationLinkSecret = newCapabilityLinkSecret();
    pendingConfirmationDeadlineAt = addHours(
      now,
      payload.pendingConfirmationDeadlineHours ??
        payload.confirmationTtlHours ??
        DEFAULT_PENDING_CONFIRMATION_DEADLINE_HOURS,
    );
  }
  const registration: RegistrationRecord = {
    id: registrationId,
    event_id: payload.event.id,
    user_id: payload.userId,
    invite_id: payload.inviteId ?? null,
    status,
    attendance_type: attendanceType,
    source_type: payload.sourceType,
    source_ref: payload.sourceRef ?? null,
    custom_answers_json: payload.customAnswersJson ?? null,
    referred_by_code: payload.referredByCode ?? null,
    confirmation_link_secret: confirmationLinkSecret,
    pending_confirmation_deadline_at: pendingConfirmationDeadlineAt,
    manage_link_secret: manageLinkSecret,
    capacity_exempt_in_person: capacityExempt ? 1 : 0,
    capacity_exempt_reason: capacityExemptReason,
    confirmed_at: status === "registered" ? now : null,
    cancelled_at: null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  if (existing) {
    await run(
      db,
      `UPDATE registrations
       SET invite_id = ?, status = ?, attendance_type = ?, source_type = ?, source_ref = ?,
           custom_answers_json = ?, referred_by_code = ?, confirmation_link_secret = ?,
           pending_confirmation_deadline_at = ?,
           manage_link_secret = ?, capacity_exempt_in_person = ?, capacity_exempt_reason = ?,
           confirmed_at = ?, cancelled_at = NULL, updated_at = ?
       WHERE id = ?`,
      [
        registration.invite_id,
        registration.status,
        registration.attendance_type,
        registration.source_type,
        registration.source_ref,
        registration.custom_answers_json,
        registration.referred_by_code,
        registration.confirmation_link_secret,
        registration.pending_confirmation_deadline_at,
        registration.manage_link_secret,
        registration.capacity_exempt_in_person,
        registration.capacity_exempt_reason,
        registration.confirmed_at,
        now,
        registration.id,
      ],
    );
  } else {
    await run(
      db,
      `INSERT INTO registrations (
      id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
      custom_answers_json, referred_by_code, confirmation_link_secret, pending_confirmation_deadline_at,
      manage_link_secret, capacity_exempt_in_person, capacity_exempt_reason,
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
        registration.confirmation_link_secret,
        registration.pending_confirmation_deadline_at,
        registration.manage_link_secret,
        registration.capacity_exempt_in_person,
        registration.capacity_exempt_reason,
        registration.confirmed_at,
        registration.cancelled_at,
        registration.created_at,
        registration.updated_at,
      ],
    );
  }
  await replaceRegistrationDayAttendance(db, {
    registrationId: registration.id,
    eventId: registration.event_id,
    selections: payload.dayAttendance,
    recordHistory: false,
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
  if (payload.referredByCode) {
    await recordReferralConversion(db, payload.referredByCode);
  }
  const manageToken = await signedOrQueuedCapability({
    signingSecret: payload.signingSecret,
    linkSecret: registration.manage_link_secret,
    purpose: "registration_manage",
    resourceId: registration.id,
  });
  const confirmationToken = registration.confirmation_link_secret
    ? await signedOrQueuedCapability({
        signingSecret: payload.signingSecret,
        linkSecret: registration.confirmation_link_secret,
        purpose: "registration_confirm",
        resourceId: registration.id,
        ttlSeconds: payload.confirmationTtlHours != null ? payload.confirmationTtlHours * 3600 : undefined,
      })
    : null;
  return { registration, manageToken, confirmationToken, reactivated: Boolean(existing) };
}
