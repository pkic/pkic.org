import { AppError } from "../../errors";
import { first, run } from "../../db/queries";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { addToWaitlist, claimWaitlistOffer, getInPersonRegisteredCount, promoteWaitlistIfCapacity } from "./waitlist";
import { deriveEventAttendanceType, replaceRegistrationDayAttendance, type DayAttendanceSelection } from "../event-days";
import {
  claimOfferedDayWaitlist,
  listInPersonEventDayIdsForRegistration,
  promoteDayWaitlistForEventDays,
  removeAllDayWaitlistForRegistration,
  resolveCapacityExemptReason,
  syncRegistrationDayWaitlist,
} from "./day-waitlist";
import { upsertAttendeeParticipant } from "./participant-registration";
import { getRegistrationByManageToken, getRegistrationById } from "./queries";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

interface UpdatePayload {
  action: "update" | "cancel" | "report_unauthorized";
  attendanceType?: "in_person" | "virtual" | "on_demand";
  dayAttendance?: DayAttendanceSelection[];
  customAnswersJson?: string | null;
  sourceRef?: string | null;
  eventCapacity: number | null;
  waitlistClaimWindowHours: number;
}

async function applyRegistrationUpdate(
  db: DatabaseLike,
  registration: RegistrationRecord,
  payload: UpdatePayload,
  changedBy = "self",
): Promise<RegistrationRecord> {
  const previousInPersonDayIds = await listInPersonEventDayIdsForRegistration(db, registration.id);

  const isCancelled = registration.status === "cancelled" || registration.status === "cancelled_unauthorized";

  if (payload.action === "cancel") {
    if (isCancelled) {
      throw new AppError(409, "ALREADY_CANCELLED", "Registration is already cancelled");
    }
    const now = nowIso();
    await run(
      db,
      `UPDATE registrations
       SET status = 'cancelled', cancelled_at = ?, updated_at = ?
       WHERE id = ?`,
      [now, now, registration.id],
    );
    await removeAllDayWaitlistForRegistration(db, {
      registrationId: registration.id,
      reasonCode: "registration_cancelled",
    });
    await upsertAttendeeParticipant(db, {
      ...registration,
      status: "cancelled",
    });
    if (previousInPersonDayIds.length > 0) {
      await promoteDayWaitlistForEventDays(db, {
        eventId: registration.event_id,
        eventDayIds: previousInPersonDayIds,
        claimWindowHours: payload.waitlistClaimWindowHours,
      });
    } else {
      await promoteWaitlistIfCapacity(
        db,
        registration.event_id,
        payload.eventCapacity,
        payload.waitlistClaimWindowHours,
      );
    }
    const cancelled = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [registration.id]);
    if (!cancelled) {
      throw new AppError(500, "REGISTRATION_CANCEL_FAILED", "Unable to cancel registration");
    }
    return cancelled;
  }

  if (payload.action === "report_unauthorized") {
    if (isCancelled) {
      throw new AppError(409, "ALREADY_CANCELLED", "This registration has already been cancelled");
    }
    const now = nowIso();
    // Cancel the registration and erase event-specific PII (custom answers).
    // The user account is not deleted — only this registration's personal data.
    await run(
      db,
      `UPDATE registrations
       SET status = 'cancelled_unauthorized', cancelled_at = ?, custom_answers_json = NULL, updated_at = ?
       WHERE id = ?`,
      [now, now, registration.id],
    );
    await removeAllDayWaitlistForRegistration(db, {
      registrationId: registration.id,
      reasonCode: "registration_cancelled",
    });
    await upsertAttendeeParticipant(db, {
      ...registration,
      status: "cancelled_unauthorized",
    });
    if (previousInPersonDayIds.length > 0) {
      await promoteDayWaitlistForEventDays(db, {
        eventId: registration.event_id,
        eventDayIds: previousInPersonDayIds,
        claimWindowHours: payload.waitlistClaimWindowHours,
      });
    } else {
      await promoteWaitlistIfCapacity(
        db,
        registration.event_id,
        payload.eventCapacity,
        payload.waitlistClaimWindowHours,
      );
    }
    const updated = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [registration.id]);
    if (!updated) {
      throw new AppError(500, "REGISTRATION_CANCEL_FAILED", "Unable to process unauthorized report");
    }
    return updated;
  }

  if (isCancelled) {
    throw new AppError(409, "ALREADY_CANCELLED", "Cannot update a cancelled registration");
  }

  const derivedAttendanceType = deriveEventAttendanceType(payload.dayAttendance);
  const effectiveAttendanceType = payload.attendanceType ?? derivedAttendanceType;
  if (!effectiveAttendanceType) {
    throw new AppError(400, "ATTENDANCE_TYPE_REQUIRED", "attendanceType is required for update action");
  }
  const capacityExemptReason = await resolveCapacityExemptReason(db, {
    registrationId: registration.id,
    eventId: registration.event_id,
    userId: registration.user_id,
  });
  const hasPerDayAttendanceInput = Boolean(payload.dayAttendance && payload.dayAttendance.length > 0);
  const hasPerDayAttendanceContext = hasPerDayAttendanceInput || previousInPersonDayIds.length > 0;
  let newStatus = registration.status;
  if (hasPerDayAttendanceContext || capacityExemptReason) {
    newStatus = isCancelled ? registration.status : "registered";
  } else if (effectiveAttendanceType !== registration.attendance_type) {
    if (effectiveAttendanceType === "in_person") {
      if (registration.status === "waitlisted") {
        await claimWaitlistOffer(db, registration.id, registration.event_id);
        newStatus = "registered";
      } else if (payload.eventCapacity) {
        const count = await getInPersonRegisteredCount(db, registration.event_id);
        if (count >= payload.eventCapacity) {
          newStatus = "waitlisted";
          await addToWaitlist(db, registration.event_id, registration.id);
        } else {
          newStatus = "registered";
        }
      }
    }
    if (registration.attendance_type === "in_person" && effectiveAttendanceType !== "in_person") {
      newStatus = isCancelled ? registration.status : "registered";
    }
  }
  await run(
    db,
    `UPDATE registrations
     SET attendance_type = ?, status = ?, custom_answers_json = COALESCE(?, custom_answers_json),
         source_ref = COALESCE(?, source_ref), capacity_exempt_in_person = ?,
         capacity_exempt_reason = ?, updated_at = ?
     WHERE id = ?`,
    [
      effectiveAttendanceType,
      newStatus,
      payload.customAnswersJson ?? null,
      payload.sourceRef ?? null,
      capacityExemptReason ? 1 : 0,
      capacityExemptReason,
      nowIso(),
      registration.id,
    ],
  );
  if (payload.dayAttendance) {
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
    await claimOfferedDayWaitlist(db, {
      registrationId: registration.id,
      eventId: registration.event_id,
      selections: payload.dayAttendance,
    });
    const nextInPersonDayIds = await listInPersonEventDayIdsForRegistration(db, registration.id);
    const releasedDayIds = previousInPersonDayIds.filter((dayId) => !nextInPersonDayIds.includes(dayId));
    if (releasedDayIds.length > 0) {
      await promoteDayWaitlistForEventDays(db, {
        eventId: registration.event_id,
        eventDayIds: releasedDayIds,
        claimWindowHours: payload.waitlistClaimWindowHours,
      });
    }
  }
  await upsertAttendeeParticipant(db, {
    ...registration,
    status: newStatus,
    attendance_type: effectiveAttendanceType,
    source_ref: payload.sourceRef ?? registration.source_ref,
  });
  if (effectiveAttendanceType !== registration.attendance_type) {
    await run(
      db,
      `INSERT INTO registration_attendance_history (
        id, registration_id, from_type, to_type, changed_by, changed_at
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      [uuid(), registration.id, registration.attendance_type, effectiveAttendanceType, changedBy, nowIso()],
    );
  }
  if (!hasPerDayAttendanceContext && registration.attendance_type === "in_person" && effectiveAttendanceType !== "in_person") {
    await promoteWaitlistIfCapacity(
      db,
      registration.event_id,
      payload.eventCapacity,
      payload.waitlistClaimWindowHours,
    );
  }
  const updated = await first<RegistrationRecord>(db, "SELECT * FROM registrations WHERE id = ?", [registration.id]);
  if (!updated) {
    throw new AppError(500, "REGISTRATION_UPDATE_FAILED", "Unable to update registration");
  }
  return updated;
}

export async function updateRegistrationByManageToken(
  db: DatabaseLike,
  payload: { manageToken: string } & UpdatePayload,
): Promise<RegistrationRecord> {
  const registration = await getRegistrationByManageToken(db, payload.manageToken);
  return applyRegistrationUpdate(db, registration, payload);
}

export async function updateRegistrationById(
  db: DatabaseLike,
  payload: { registrationId: string } & UpdatePayload,
  changedBy: string,
): Promise<RegistrationRecord> {
  const registration = await getRegistrationById(db, payload.registrationId);
  return applyRegistrationUpdate(db, registration, payload, changedBy);
}
