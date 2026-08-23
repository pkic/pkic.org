import { adminRegistrationDetailResponseSchema } from "../../../../assets/shared/schemas/admin-registration-detail";
import type { AdminRegistrationDetailResponse } from "../../../../assets/shared/schemas/admin-registration-detail";
import { first } from "../../db/queries";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { getRegistrationDayAttendance } from "../event-days";
import { getActiveFormByPurpose } from "../forms";
import { firstReferralCodeForOwnerSql } from "../referral-code-projection";
import { listDayWaitlistForRegistration } from "./day-waitlist";

const registrationReferralCodeSql = firstReferralCodeForOwnerSql("registration", "r.id");

export interface AdminRegistrationDetailRow {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  cancellation_reason_code: string | null;
  attendance_type: string;
  source_type: string;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  display_name: string | null;
  referral_code: string | null;
  rsvp_status: string | null;
  rsvp_by_day_json: string | null;
  custom_answers_json: string | null;
}

export async function fetchAdminRegistrationWithDetails(
  db: DatabaseLike,
  eventId: string,
  registrationId: string,
): Promise<AdminRegistrationDetailRow | null> {
  return first<AdminRegistrationDetailRow>(
    db,
    `SELECT r.id, r.event_id, r.user_id, r.status, r.cancellation_reason_code, r.attendance_type, r.source_type,
            r.custom_answers_json, r.created_at, r.updated_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            ${registrationReferralCodeSql} AS referral_code,
            (SELECT response_status
             FROM calendar_rsvp_events
             WHERE registration_id = r.id
             ORDER BY julianday(received_at) DESC, id DESC
             LIMIT 1) AS rsvp_status,
            COALESCE((
              SELECT JSON_GROUP_ARRAY(JSON_OBJECT(
                'event_day_id', event_day_id,
                'day_date', day_date,
                'status', response_status,
                'received_at', received_at,
                'ics_uid', ics_uid,
                'action_taken', action_taken
              ))
              FROM (
                SELECT event_day_id, day_date, response_status, received_at, ics_uid, action_taken
                FROM (
                  SELECT cre.event_day_id, ed.day_date, cre.response_status, cre.received_at,
                         cre.ics_uid, cre.action_taken,
                         ROW_NUMBER() OVER (
                           PARTITION BY cre.event_day_id
                           ORDER BY julianday(cre.received_at) DESC, cre.id DESC
                         ) AS rn
                  FROM calendar_rsvp_events cre
                  LEFT JOIN event_days ed ON ed.id = cre.event_day_id
                  WHERE cre.registration_id = r.id
                )
                WHERE rn = 1
                ORDER BY event_day_id
              )
            ), '[]') AS rsvp_by_day_json
     FROM registrations r
     LEFT JOIN users u ON u.id = r.user_id
     WHERE r.id = ? AND r.event_id = ?`,
    [registrationId, eventId],
  );
}

export async function getRegistrationNormalizedEmail(
  db: DatabaseLike,
  eventId: string,
  registrationId: string,
): Promise<string | null> {
  const row = await first<{ normalized_email: string }>(
    db,
    `SELECT u.normalized_email
       FROM registrations r
       JOIN users u ON u.id = r.user_id
      WHERE r.id = ? AND r.event_id = ?`,
    [registrationId, eventId],
  );
  return row?.normalized_email ?? null;
}

export function toAdminRegistrationDetail(
  registration: AdminRegistrationDetailRow,
): AdminRegistrationDetailResponse["registration"] {
  return {
    id: registration.id,
    event_id: registration.event_id,
    user_id: registration.user_id,
    status: registration.status,
    cancellation_reason_code: registration.cancellation_reason_code,
    attendance_type: registration.attendance_type,
    source_type: registration.source_type,
    created_at: registration.created_at,
    updated_at: registration.updated_at,
    user_email: registration.user_email,
    display_name: registration.display_name,
    referral_code: registration.referral_code,
    rsvp_status: registration.rsvp_status,
    rsvpByDay: parseJsonSafe<AdminRegistrationDetailResponse["registration"]["rsvpByDay"]>(
      registration.rsvp_by_day_json,
      [],
    ),
    customAnswers: parseJsonSafe<Record<string, unknown> | null>(registration.custom_answers_json, null),
  };
}

export async function getAdminRegistrationDetail(
  db: DatabaseLike,
  eventId: string,
  registrationId: string,
): Promise<AdminRegistrationDetailResponse | null> {
  const registration = await fetchAdminRegistrationWithDetails(db, eventId, registrationId);
  if (!registration) return null;

  const [dayAttendance, dayWaitlist] = await Promise.all([
    getRegistrationDayAttendance(db, registration.id),
    listDayWaitlistForRegistration(db, registration.id),
  ]);
  const registrationForm = await getActiveFormByPurpose(db, eventId, "event_registration");

  return adminRegistrationDetailResponseSchema.parse({
    registration: toAdminRegistrationDetail(registration),
    form:
      registrationForm == null
        ? null
        : {
            id: registrationForm.id,
            title: registrationForm.title,
            description: registrationForm.description,
            fields: registrationForm.fields,
          },
    dayAttendance,
    dayWaitlist,
  });
}
