import { REGISTRATION_ORGANIZATION_SQL, REGISTRATION_JOB_TITLE_SQL } from "./selected-identity";
import { batchFirst, batchRows } from "../../db/pagination";
import type { DatabaseLike } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import {
  prepareEventDays,
  prepareRegistrationDayAttendance,
  prepareRegisteredEventDayCounts,
  decodeRegisteredEventDayCounts,
  type EventDayRecord,
  type RegistrationDayAttendanceRow,
  type EventDayAttendanceCountRow,
} from "../event-days";
import { prepareEventById, type EventRecord } from "../events";
import { firstReferralCodeQuerySql } from "../referral-code-projection";
import { prepareRegistrationDayWaitlist, type RegistrationDayWaitlistRow } from "./day-waitlist-queries";
import type { RegistrationRecord } from "./types";
import { publicUserHeadshotUrl } from "../user-headshot";
import { eventDayReadModels } from "../event-read-models";
import { AppError } from "../../errors";
import { registrationManageReadResponseSchema } from "../../../../assets/shared/schemas/registration";
import { personalPromotionSharePath } from "../../../../assets/shared/personal-promotion-image";
import {
  prepareRegistrationSponsorSharing,
  decodeRegistrationSponsorSharing,
  type RegistrationSponsorSharingRow,
} from "../event-participation/sponsor-consent";
import { holdsWorkAddress } from "../../email-domains/contact-kind";
import { parseVerifiedAddresses, verifiedAddressesJsonSql } from "../user-emails";

interface ManageUserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  headshot_r2_key: string | null;
  verified_addresses: string | null;
}

export async function buildRegistrationManageView(
  db: DatabaseLike,
  registration: RegistrationRecord,
  appBaseUrl: string,
) {
  const [
    eventResult,
    userResult,
    referralResult,
    daysResult,
    attendanceResult,
    waitlistResult,
    countsResult,
    sharingResult,
    pendingReviewResult,
  ] = await db.batch([
    prepareEventById(db, registration.event_id),
    db
      .prepare(
        `SELECT u.id, u.email, u.first_name, u.last_name, ${verifiedAddressesJsonSql("u.id")} AS verified_addresses,
             ${REGISTRATION_ORGANIZATION_SQL} AS organization_name, ${REGISTRATION_JOB_TITLE_SQL} AS job_title, u.headshot_r2_key
             FROM registrations r JOIN users u ON u.id = r.user_id
              WHERE r.id = ?`,
      )
      .bind(registration.id),
    db.prepare(firstReferralCodeQuerySql("registration", "?")).bind(registration.id),
    prepareEventDays(db, registration.event_id),
    prepareRegistrationDayAttendance(db, registration.id),
    prepareRegistrationDayWaitlist(db, registration.id),
    prepareRegisteredEventDayCounts(db, registration.event_id),
    prepareRegistrationSponsorSharing(db, registration),
    db
      .prepare(
        `SELECT organization_name FROM affiliation_reviews
          WHERE user_id = ? AND source_type = 'registration' AND source_id = ? AND resolved_at IS NULL
          ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(registration.user_id, registration.id),
  ]);
  const event = batchFirst<EventRecord>(eventResult);
  if (!event) throw new AppError(404, "EVENT_NOT_FOUND", "Event not found");
  const eventDays = batchRows<EventDayRecord>(daysResult);
  const dayAttendance = batchRows<RegistrationDayAttendanceRow>(attendanceResult);
  const dayWaitlist = batchRows<RegistrationDayWaitlistRow>(waitlistResult);
  const registeredCounts = decodeRegisteredEventDayCounts(batchRows<EventDayAttendanceCountRow>(countsResult));
  const sponsorSharing = decodeRegistrationSponsorSharing(batchFirst<RegistrationSponsorSharingRow>(sharingResult));
  const user = batchFirst<ManageUserRow>(userResult);
  if (!user) {
    throw new AppError(409, "REGISTRATION_USER_MISSING", "The registration identity is no longer available");
  }
  const referral = batchFirst<{ code: string }>(referralResult);
  const pendingOrganizationName = batchFirst<{ organization_name: string | null }>(
    pendingReviewResult,
  )?.organization_name;
  const headshotUrl = publicUserHeadshotUrl(appBaseUrl, user.id, user.headshot_r2_key);

  return registrationManageReadResponseSchema.parse({
    success: true,
    sponsorSharing,
    identityId: registration.registration_identity_id ?? null,
    badgeVersion: registration.updated_at,
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
    shareUrl: referral ? `${appBaseUrl}${personalPromotionSharePath(referral.code)}` : null,
    eventDays: eventDayReadModels(
      eventDays,
      registeredCounts,
      registration.status === "cancelled" ? [] : dayAttendance,
    ),
    dayAttendance,
    dayWaitlist,
    waitlistHandledLast: !holdsWorkAddress(parseVerifiedAddresses(user.verified_addresses)),
    pendingOrganizationName: user.organization_name ? null : (pendingOrganizationName ?? null),
  });
}
