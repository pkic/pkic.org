import { batchFirst } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { countRegisteredByEventDay, getRegistrationDayAttendance, listEventDays } from "../event-days";
import { getEventById } from "../events";
import { listDayWaitlistForRegistration } from "./day-waitlist";
import type { RegistrationRecord } from "./types";
import { publicUserHeadshotUrl } from "../user-headshot";
import { eventDayReadModels } from "../event-read-models";
import { AppError } from "../../errors";
import { registrationManageReadResponseSchema } from "../../../../assets/shared/schemas/registration";

interface ManageUserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  headshot_r2_key: string | null;
}

export async function buildRegistrationManageView(
  db: DatabaseLike,
  registration: RegistrationRecord,
  appBaseUrl: string,
) {
  const event = await getEventById(db, registration.event_id);
  const [identityResults, eventDays, dayAttendance, dayWaitlist, registeredCounts] = await Promise.all([
    db.batch([
      db
        .prepare(
          `SELECT id, email, first_name, last_name, organization_name, job_title, headshot_r2_key
             FROM users WHERE id = ?`,
        )
        .bind(registration.user_id),
      db
        .prepare(
          `SELECT code FROM referral_codes
            WHERE owner_type = 'registration' AND owner_id = ?
            ORDER BY created_at ASC LIMIT 1`,
        )
        .bind(registration.id),
    ]),
    listEventDays(db, registration.event_id),
    getRegistrationDayAttendance(db, registration.id),
    listDayWaitlistForRegistration(db, registration.id),
    countRegisteredByEventDay(db, event.id),
  ]);
  const user = batchFirst<ManageUserRow>(identityResults[0]);
  if (!user) {
    throw new AppError(409, "REGISTRATION_USER_MISSING", "The registration identity is no longer available");
  }
  const referral = batchFirst<{ code: string }>(identityResults[1]);
  const headshotUrl = publicUserHeadshotUrl(appBaseUrl, user?.headshot_r2_key ?? null);

  return registrationManageReadResponseSchema.parse({
    success: true,
    registration: {
      id: registration.id,
      event_id: registration.event_id,
      status: registration.status,
      cancellation_reason_code: registration.cancellation_reason_code,
      attendance_type: registration.attendance_type,
      custom_answers: parseJsonSafe<Record<string, unknown> | null>(registration.custom_answers_json, null),
      isEmailVerified: registration.confirmed_at !== null,
    },
    event: { id: event.id, slug: event.slug, name: event.name },
    user: {
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      organization_name: user.organization_name,
      job_title: user.job_title,
    },
    headshotUrl,
    shareUrl: referral ? `${appBaseUrl}/r/${referral.code}` : null,
    eventDays: eventDayReadModels(eventDays, registeredCounts),
    dayAttendance,
    dayWaitlist,
  });
}
