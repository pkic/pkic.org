import { registrationManageSchema } from "../../../../assets/shared/schemas/registration";
import type { DatabaseLike } from "../../types";
import { deriveEventAttendanceType } from "../event-days";
import { getEventById } from "../events";
import { validateCustomAnswersByPurpose } from "../forms";
import { getNormalizedEmailForUser } from "../users";
import type { z } from "zod";
import type { RegistrationRecord } from "./types";
import {
  updateRegistrationByIdWithEmailChange,
  updateRegistrationByIdWithNotification,
  updateRegistrationByManageTokenWithEmailChange,
  updateRegistrationByManageTokenWithNotification,
} from "./update";

type RegistrationManageBody = z.infer<typeof registrationManageSchema>;

export interface ManageRegistrationUpdateInput {
  registration: RegistrationRecord;
  manageToken: string;
  isAdminManageJwt: boolean;
  actorUserId: string;
  body: RegistrationManageBody;
  appBaseUrl: string;
  signingSecret: string;
  confirmationLinkTtlHours: number;
  waitlistClaimWindowHours: number;
}

export interface ManageRegistrationUpdateResult {
  registration: RegistrationRecord;
  outboxId: string | null;
  emailChanged: boolean;
}

/**
 * Executes the registration self-service command, including form validation,
 * profile/email changes, audit context, and the durable notification intent.
 */
export async function updateManagedRegistration(
  db: DatabaseLike,
  input: ManageRegistrationUpdateInput,
): Promise<ManageRegistrationUpdateResult> {
  const { body, registration: current } = input;
  const event = await getEventById(db, current.event_id);
  const attendanceType = body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined;
  const customAnswers =
    body.customAnswers !== undefined
      ? await validateCustomAnswersByPurpose(db, {
          eventId: event.id,
          purpose: "event_registration",
          customAnswers: body.customAnswers,
          context: { attendanceType, dayAttendance: body.dayAttendance },
        })
      : {};
  const profilePatch =
    body.action === "update"
      ? {
          firstName: body.firstName,
          lastName: body.lastName,
          organizationName: body.organizationName,
          jobTitle: body.jobTitle,
        }
      : undefined;

  const currentEmail =
    body.action === "update" && body.email ? await getNormalizedEmailForUser(db, current.user_id) : null;
  const emailChanged = Boolean(currentEmail && body.email && body.email.trim().toLowerCase() !== currentEmail);
  const updatePayload = {
    action: body.action,
    attendanceType,
    dayAttendance: body.dayAttendance,
    claimDayWaitlistOffers: body.claimDayWaitlistOffers,
    customAnswersJson: body.customAnswers !== undefined ? JSON.stringify(customAnswers) : undefined,
    sourceRef: body.sourceRef,
    waitlistClaimWindowHours: input.waitlistClaimWindowHours,
    profilePatch,
    auditActor: {
      type: input.isAdminManageJwt ? ("admin" as const) : ("user" as const),
      id: input.actorUserId,
      action: `self_service_${body.action}`,
    },
  };
  const notification = {
    event,
    appBaseUrl: input.appBaseUrl,
    templateKey: body.action === "report_unauthorized" ? "registration_unauthorized" : "registration_updated",
    subject:
      body.action === "report_unauthorized"
        ? `Your registration for ${event.name} has been cancelled and your data removed`
        : `Registration updated for ${event.name}`,
  };

  if (emailChanged && body.email) {
    const emailChange = {
      newEmail: body.email,
      confirmationTtlHours: input.confirmationLinkTtlHours,
      signingSecret: input.signingSecret,
      allowCancelled: true,
      auditActor: {
        type: input.isAdminManageJwt ? ("admin" as const) : ("user" as const),
        id: input.actorUserId,
        action: "email_changed",
        eventId: event.id,
      },
      confirmationEmail: {
        event,
        appBaseUrl: input.appBaseUrl,
        confirmationTtlHours: input.confirmationLinkTtlHours,
      },
    };
    const result = input.isAdminManageJwt
      ? await updateRegistrationByIdWithEmailChange(
          db,
          { ...updatePayload, registrationId: current.id, emailChange },
          "admin",
        )
      : await updateRegistrationByManageTokenWithEmailChange(db, {
          ...updatePayload,
          manageToken: input.manageToken,
          signingSecret: input.signingSecret,
          emailChange,
        });
    return { registration: result.registration, outboxId: result.outboxId, emailChanged };
  }

  const result = input.isAdminManageJwt
    ? await updateRegistrationByIdWithNotification(
        db,
        { ...updatePayload, registrationId: current.id, notification },
        "admin",
      )
    : await updateRegistrationByManageTokenWithNotification(db, {
        ...updatePayload,
        manageToken: input.manageToken,
        signingSecret: input.signingSecret,
        notification,
      });
  return { registration: result.registration, outboxId: result.outboxId, emailChanged };
}
