import { batchFirst } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import {
  countRegisteredByEventDay,
  getRegistrationDayAttendance,
  listEventDays,
  resolveAttendanceOptions,
} from "../event-days";
import { getEventById } from "../events";
import { listDayWaitlistForRegistration } from "./day-waitlist";
import type { RegistrationRecord } from "./types";
import { omitCapabilitySecrets } from "../capability-links";

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
  manageToken: string,
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
  const referral = batchFirst<{ code: string }>(identityResults[1]);
  const headshotUrl = user?.headshot_r2_key
    ? `${appBaseUrl}/api/v1/headshots/${user.id}/${user.headshot_r2_key.split("/").slice(2).join("/")}`
    : null;

  return {
    success: true,
    registration: {
      ...omitCapabilitySecrets(registration),
      custom_answers: parseJsonSafe<Record<string, unknown> | null>(registration.custom_answers_json, null),
      isEmailVerified: registration.confirmed_at !== null,
    },
    event,
    user,
    headshotUrl,
    shareUrl: referral ? `${appBaseUrl}/r/${referral.code}` : null,
    manageToken,
    eventDays: eventDays.map((day) => ({
      dayDate: day.day_date,
      label: day.label,
      inPersonCapacity: day.in_person_capacity,
      sortOrder: day.sort_order,
      attendanceOptions: resolveAttendanceOptions(day).map((option) => {
        const capacity = option.capacity ?? null;
        const registered = registeredCounts.get(day.id)?.get(option.value) ?? 0;
        return {
          value: option.value,
          label: option.label,
          spotsRemainingPercent:
            capacity != null && capacity > 0 ? Math.round(((capacity - registered) / capacity) * 100) : null,
        };
      }),
    })),
    dayAttendance,
    dayWaitlist,
  };
}
