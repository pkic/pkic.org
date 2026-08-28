import { first } from "../../db/queries";
import { AppError } from "../../errors";
import { prepareQueueEmailStatement } from "../../email/outbox";
import { buildBadgeAttachment } from "../../email/attachments";
import { buildEventEmailVariables } from "../events";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../utils/registration-email";
import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../utils/attendance";
import { buildRegistrationIcs } from "../../utils/calendar";
import { generateSignedRsvpAddress } from "../../email/rsvp";
import { getRegistrationDayAttendance } from "../event-days";
import { listDayWaitlistForRegistration } from "./day-waitlist";
import type { DatabaseLike, StatementLike } from "../../types";
import type { UserProfilePatch } from "../users";
import { REGISTRATION_RECIPIENT_EMAIL_SQL } from "./recipient-email";
import { REGISTRATION_COLUMNS, type RegistrationRecord } from "./types";
import { registrationConfirmationUrl, registrationManageCapability } from "./capability-urls";

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
  source_mode?: "hugo" | "portal" | "integration" | null;
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  base_path: string | null;
  settings_json: string;
}

interface RegistrationEmailOverrides {
  registration?: RegistrationRecord;
  profilePatch?: UserProfilePatch;
  dayAttendance?: Awaited<ReturnType<typeof getRegistrationDayAttendance>>;
  dayWaitlist?: Awaited<ReturnType<typeof listDayWaitlistForRegistration>>;
}

async function loadRegistrationEmailContext(
  db: DatabaseLike,
  event: RegistrationStatusEmailEvent,
  registrationId: string,
  overrides: RegistrationEmailOverrides = {},
): Promise<{
  registration: RegistrationRecord;
  user: UserRow;
  dayAttendance: Awaited<ReturnType<typeof getRegistrationDayAttendance>>;
  dayWaitlist: Awaited<ReturnType<typeof listDayWaitlistForRegistration>>;
  customAnswerRows: Awaited<ReturnType<typeof getCustomAnswerRows>>;
  acceptedTermsText: string;
}> {
  const registration =
    overrides.registration ??
    (await first<RegistrationRecord>(
      db,
      `SELECT ${REGISTRATION_COLUMNS} FROM registrations WHERE id = ? AND event_id = ?`,
      [registrationId, event.id],
    ));
  if (!registration) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  const storedUser = await first<UserRow>(
    db,
    `SELECT u.id, ${REGISTRATION_RECIPIENT_EMAIL_SQL} AS email,
            u.first_name, u.last_name, u.organization_name, u.job_title
       FROM registrations r
       JOIN users u ON u.id = r.user_id
      WHERE r.id = ? AND r.event_id = ?`,
    [registration.id, event.id],
  );
  if (!storedUser) throw new AppError(404, "USER_NOT_FOUND", "Associated user record is missing");
  const patch = overrides.profilePatch;
  const user: UserRow = {
    ...storedUser,
    first_name: patch?.firstName === undefined ? storedUser.first_name : (patch.firstName ?? null),
    last_name: patch?.lastName === undefined ? storedUser.last_name : (patch.lastName ?? null),
    organization_name:
      patch?.organizationName === undefined ? storedUser.organization_name : (patch.organizationName ?? null),
    job_title: patch?.jobTitle === undefined ? storedUser.job_title : (patch.jobTitle ?? null),
  };
  const [dayAttendance, dayWaitlist, customAnswerRows, acceptedTermsText] = await Promise.all([
    overrides.dayAttendance ?? getRegistrationDayAttendance(db, registration.id),
    overrides.dayWaitlist ?? listDayWaitlistForRegistration(db, registration.id),
    getCustomAnswerRows(db, {
      sourceId: registration.id,
      event: { id: event.id, source_mode: event.source_mode ?? null },
      formPlacementId: registration.form_placement_id,
      answersJson: registration.custom_answers_json,
    }),
    getAcceptedTermsTextForRegistration(db, registration.id),
  ]);
  return { registration, user, dayAttendance, dayWaitlist, customAnswerRows, acceptedTermsText };
}

export interface RegistrationStatusEmailParams extends RegistrationEmailOverrides {
  event: RegistrationStatusEmailEvent;
  registrationId: string;
  appBaseUrl: string;
  templateKey: string;
  subject: string;
  noticeKind?: "status_update" | "waitlist_offer" | "admin_admit";
  /** Override only for a deliberately selected pending/bounce fallback address. */
  recipientEmailOverride?: string;
  /** Stable operation identity for notification enqueueing across retried promotion batches. */
  outboxId?: string;
  idempotencyKey?: string;
}

export async function prepareRegistrationStatusEmail(
  db: DatabaseLike,
  params: RegistrationStatusEmailParams,
): Promise<{ outboxId: string; statement: StatementLike; manageToken: string; manageUrl: string }> {
  const { registration, user, dayAttendance, dayWaitlist, customAnswerRows, acceptedTermsText } =
    await loadRegistrationEmailContext(db, params.event, params.registrationId, params);
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, dayAttendance, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(registration.status, dayWaitlist);
  const { manageToken, manageUrl } = await registrationManageCapability(params.appBaseUrl, params.event, registration);
  const recipientEmail = params.recipientEmailOverride ?? user.email;
  const prepared = prepareQueueEmailStatement(db, {
    outboxId: params.outboxId,
    idempotencyKey: params.idempotencyKey,
    eventId: params.event.id,
    baseUrl: params.appBaseUrl,
    templateKey: params.templateKey,
    recipientEmail,
    recipientUserId: user.id,
    messageType: "transactional",
    subject: params.subject,
    capabilityLinkValues: [manageUrl],
    data: {
      ...buildEventEmailVariables(params.event, params.appBaseUrl),
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      email: recipientEmail,
      organizationName: user.organization_name ?? "",
      jobTitle: user.job_title ?? "",
      attendanceType: registration.attendance_type,
      attendanceLabel: attendanceData.attendanceLabel,
      dayAttendance: attendanceData.dayAttendance,
      dayWaitlist,
      customAnswerRows,
      acceptedTermsText: acceptedTermsText || undefined,
      ...statusData,
      manageUrl,
      shareUrl: null,
      waitlistOfferNotice: params.noticeKind === "waitlist_offer",
      adminAdmitNotice: params.noticeKind === "admin_admit",
    },
  });
  return { outboxId: prepared.id, statement: prepared.statement, manageToken, manageUrl };
}

export async function queueRegistrationStatusEmail(
  db: DatabaseLike,
  params: RegistrationStatusEmailParams,
): Promise<{ outboxId: string; manageToken: string; manageUrl: string }> {
  const prepared = await prepareRegistrationStatusEmail(db, params);
  await db.batch([prepared.statement]);
  return { outboxId: prepared.outboxId, manageToken: prepared.manageToken, manageUrl: prepared.manageUrl };
}

export interface RegistrationConfirmedEmailParams extends RegistrationEmailOverrides {
  event: RegistrationStatusEmailEvent;
  registrationId: string;
  appBaseUrl: string;
  recipientEmailOverride?: string;
  referralCode?: string | null;
  internalSigningSecret?: string;
  rsvpEmail?: string;
  outboxId?: string;
  idempotencyKey?: string;
}

/** Canonical confirmed-registration email, calendar, badge, and share payload. */
export async function prepareRegistrationConfirmedEmail(
  db: DatabaseLike,
  params: RegistrationConfirmedEmailParams,
): Promise<{ outboxId: string; statement: StatementLike; manageUrl: string }> {
  const { registration, user, dayAttendance, dayWaitlist, customAnswerRows, acceptedTermsText } =
    await loadRegistrationEmailContext(db, params.event, params.registrationId, params);
  const recipientEmail = params.recipientEmailOverride ?? user.email;
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, dayAttendance, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData(registration.status, dayWaitlist);
  const { manageUrl } = await registrationManageCapability(params.appBaseUrl, params.event, registration);
  const rsvpAddress = params.internalSigningSecret
    ? await generateSignedRsvpAddress(registration.id, params.internalSigningSecret, params.rsvpEmail)
    : undefined;
  const calendar = await buildRegistrationIcs(
    params.event,
    registration.id,
    manageUrl,
    dayAttendance,
    params.appBaseUrl,
    rsvpAddress,
    recipientEmail,
    params.internalSigningSecret,
  );
  const shareUrl = params.referralCode ? `${params.appBaseUrl}/r/${params.referralCode}` : null;
  const prepared = prepareQueueEmailStatement(db, {
    outboxId: params.outboxId,
    idempotencyKey: params.idempotencyKey,
    eventId: params.event.id,
    baseUrl: params.appBaseUrl,
    templateKey: "registration_confirmed",
    recipientEmail,
    recipientUserId: user.id,
    messageType: "transactional",
    subject: `Registration confirmed for ${params.event.name}`,
    capabilityLinkValues: [manageUrl],
    attachments: params.referralCode
      ? [
          buildBadgeAttachment({
            badgeCode: params.referralCode,
            badgeType: "attendee",
            firstName: user.first_name ?? "",
            lastName: user.last_name ?? "",
          }),
        ]
      : undefined,
    data: {
      ...buildEventEmailVariables(params.event, params.appBaseUrl),
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      email: recipientEmail,
      organizationName: user.organization_name ?? "",
      jobTitle: user.job_title ?? "",
      attendanceType: registration.attendance_type,
      attendanceLabel: attendanceData.attendanceLabel,
      dayAttendance: attendanceData.dayAttendance,
      dayWaitlist,
      customAnswerRows,
      acceptedTermsText: acceptedTermsText || undefined,
      ...statusData,
      registrationId: registration.id,
      manageUrl,
      shareUrl,
      ...(shareUrl
        ? {
            badgeImageUrl: `${params.appBaseUrl}/api/v1/og/${params.referralCode}`,
            linkedinShareUrl: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`,
            twitterShareUrl: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`I just registered for ${params.event.name} — join me! ${shareUrl}`)}`,
            blueskyShareUrl: `https://bsky.app/intent/compose?text=${encodeURIComponent(`I just registered for ${params.event.name} — join me!\n${shareUrl}`)}`,
            redditShareUrl: `https://www.reddit.com/submit?url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(`Join me at ${params.event.name}`)}`,
          }
        : {}),
    },
    bounceAddress: rsvpAddress,
    calendar: {
      registrationId: registration.id,
      eventId: params.event.id,
      icsUid: calendar.uid,
      icsFiles: calendar.files,
      inlineContent: calendar.inlineContent,
    },
  });
  return { outboxId: prepared.id, statement: prepared.statement, manageUrl };
}

export interface RegistrationConfirmationEmailParams extends RegistrationEmailOverrides {
  event: RegistrationStatusEmailEvent;
  registrationId: string;
  appBaseUrl: string;
  recipientEmail?: string;
  confirmationTtlHours: number;
  subject?: string;
  kind?: "registration" | "email_change_confirmation";
  currentEmail?: string;
  newEmail?: string;
  outboxId?: string;
  idempotencyKey?: string;
}

export async function prepareRegistrationConfirmationEmail(
  db: DatabaseLike,
  params: RegistrationConfirmationEmailParams,
): Promise<{ outboxId: string; statement: StatementLike; confirmationUrl: string }> {
  const { registration, user, dayAttendance, dayWaitlist, customAnswerRows, acceptedTermsText } =
    await loadRegistrationEmailContext(db, params.event, params.registrationId, params);
  const recipientEmail = params.recipientEmail ?? user.email;
  const attendanceData = buildAttendanceEmailData(registration.attendance_type, dayAttendance, dayWaitlist);
  const statusData = buildRegistrationEmailStatusData("pending_email_confirmation", dayWaitlist);
  const kind = params.kind ?? "registration";
  const confirmationUrl = await registrationConfirmationUrl(
    params.appBaseUrl,
    params.event,
    registration,
    params.confirmationTtlHours,
  );
  const prepared = prepareQueueEmailStatement(db, {
    outboxId: params.outboxId,
    idempotencyKey: params.idempotencyKey,
    eventId: params.event.id,
    baseUrl: params.appBaseUrl,
    templateKey: kind === "registration" ? "registration_confirm_email" : "registration_email_change",
    recipientEmail,
    recipientUserId: user.id,
    messageType: "transactional",
    subject:
      params.subject ??
      (kind === "email_change_confirmation"
        ? `Confirm your new email address for ${params.event.name}`
        : `Confirm your email address for ${params.event.name}`),
    capabilityLinkValues: [confirmationUrl],
    data: {
      ...buildEventEmailVariables(params.event, params.appBaseUrl),
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      email: recipientEmail,
      organizationName: user.organization_name ?? "",
      jobTitle: user.job_title ?? "",
      attendanceLabel: attendanceData.attendanceLabel,
      dayAttendance: attendanceData.dayAttendance,
      customAnswerRows,
      dayWaitlist,
      acceptedTermsText: acceptedTermsText || undefined,
      ...statusData,
      registrationId: registration.id,
      confirmationUrl,
      emailChangeConfirmation: kind === "email_change_confirmation",
      currentEmail: params.currentEmail,
      newEmail: params.newEmail,
      manageUrl: `${params.appBaseUrl}/events/${params.event.slug}/manage`,
      shareUrl: null,
    },
  });
  return { outboxId: prepared.id, statement: prepared.statement, confirmationUrl };
}

export interface RegistrationEmailChangeNoticeParams extends RegistrationEmailOverrides {
  event: RegistrationStatusEmailEvent;
  registrationId: string;
  appBaseUrl: string;
  currentEmail: string;
  newEmail: string;
}

/** Queues a non-authorizing security alert to the former login address. */
export async function prepareRegistrationEmailChangeNotice(
  db: DatabaseLike,
  params: RegistrationEmailChangeNoticeParams,
): Promise<{ outboxId: string; statement: StatementLike }> {
  const { user } = await loadRegistrationEmailContext(db, params.event, params.registrationId, params);
  const prepared = prepareQueueEmailStatement(db, {
    eventId: params.event.id,
    baseUrl: params.appBaseUrl,
    templateKey: "registration_email_change_notice",
    recipientEmail: params.currentEmail,
    recipientUserId: user.id,
    messageType: "transactional",
    subject: "Your account email change was requested",
    data: {
      ...buildEventEmailVariables(params.event, params.appBaseUrl),
      firstName: user.first_name ?? "",
      lastName: user.last_name ?? "",
      currentEmail: params.currentEmail,
      newEmail: params.newEmail,
      contactUrl: `${params.appBaseUrl}/contact/`,
    },
  });
  return { outboxId: prepared.id, statement: prepared.statement };
}

export async function queueRegistrationConfirmationEmail(
  db: DatabaseLike,
  params: RegistrationConfirmationEmailParams,
): Promise<{ outboxId: string; confirmationUrl: string }> {
  const prepared = await prepareRegistrationConfirmationEmail(db, params);
  await db.batch([prepared.statement]);
  return { outboxId: prepared.outboxId, confirmationUrl: prepared.confirmationUrl };
}
