import { first, run } from "../../db/queries";
import { AppError } from "../../errors";
import { queueEmail } from "../../email/outbox";
import { buildEventEmailVariables } from "../events";
import { registrationManagePageUrl } from "../frontend-links";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../utils/registration-email";
import { buildAttendanceEmailData, STATUS_LABELS } from "../../utils/attendance";
import { randomToken, sha256Hex } from "../../utils/crypto";
import { nowIso } from "../../utils/time";
import { getRegistrationDayAttendance } from "../event-days";
import { listDayWaitlistForRegistration } from "./day-waitlist";
import type { DatabaseLike } from "../../types";
import type { RegistrationRecord } from "./types";

interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
}

export interface RegistrationStatusEmailEvent {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  base_path: string | null;
  settings_json: string;
}

export async function queueRegistrationStatusEmail(
  db: DatabaseLike,
  params: {
    event: RegistrationStatusEmailEvent;
    registrationId: string;
    appBaseUrl: string;
    templateKey: string;
    subject: string;
    noticeKind?: "status_update" | "waitlist_offer";
  },
): Promise<{ outboxId: string; manageToken: string; manageUrl: string }> {
  const registration = await first<RegistrationRecord>(
    db,
    "SELECT * FROM registrations WHERE id = ? AND event_id = ?",
    [params.registrationId, params.event.id],
  );
  if (!registration) {
    throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }

  const user = await first<UserRow>(
    db,
    "SELECT id, email, first_name, last_name, organization_name, job_title FROM users WHERE id = ?",
    [registration.user_id],
  );
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "Associated user record is missing");
  }

  const [dayAttendance, currentDayWaitlist] = await Promise.all([
    getRegistrationDayAttendance(db, registration.id),
    listDayWaitlistForRegistration(db, registration.id),
  ]);
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, dayAttendance, currentDayWaitlist);
  const customAnswerRows = await getCustomAnswerRows(db, params.event.id, registration.custom_answers_json);
  const acceptedTermsText = await getAcceptedTermsTextForRegistration(db, registration.id);

  const manageToken = randomToken(24);
  const manageTokenHash = await sha256Hex(manageToken);
  await run(
    db,
    "UPDATE registrations SET manage_token_hash = ?, updated_at = ? WHERE id = ?",
    [manageTokenHash, nowIso(), registration.id],
  );

  const manageUrl = registrationManagePageUrl(params.appBaseUrl, params.event, manageToken);
  const outboxId = await queueEmail(db, {
    eventId: params.event.id,
    templateKey: params.templateKey,
    recipientEmail: user.email,
    recipientUserId: user.id,
    messageType: "transactional",
    subject: params.subject,
    data: {
      ...buildEventEmailVariables(params.event, params.appBaseUrl),
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      email: user.email,
      organizationName: user.organization_name ?? "",
      jobTitle: user.job_title ?? "",
      attendanceType: registration.attendance_type,
      attendanceLabel: attendanceData.attendanceLabel,
      dayAttendance: attendanceData.dayAttendance,
      dayWaitlist: currentDayWaitlist,
      customAnswerRows,
      acceptedTermsText: acceptedTermsText || undefined,
      status: registration.status,
      statusLabel: STATUS_LABELS[registration.status] ?? registration.status,
      manageUrl,
      shareUrl: null,
      waitlistOfferNotice: params.noticeKind === "waitlist_offer",
    },
  });

  return { outboxId, manageToken, manageUrl };
}
