import { registrationManageSchema } from "../../../../assets/shared/schemas/registration";
import type { DatabaseLike } from "../../types";
import { deriveEventAttendanceType } from "../event-days";
import { getEventById } from "../events";
import {
  prepareReplaceContextFormSubmission,
  toEventFormResolutionEvent,
  validateCustomAnswersForSubmission,
} from "../forms";
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
  authenticatedActor: { kind: "admin" | "member"; id: string } | null;
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
  outboxIds: string[];
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
  const validatedForm =
    body.customAnswers !== undefined
      ? await validateCustomAnswersForSubmission(db, {
          event: toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
          purpose: "event_registration",
          customAnswers: body.customAnswers,
          context: { attendanceType, dayAttendance: body.dayAttendance },
        })
      : null;
  const customAnswers = validatedForm?.answers ?? {};
  const formSubmission = validatedForm?.form
    ? await prepareReplaceContextFormSubmission(
        db,
        validatedForm.form,
        {
          submittedByUserId: current.user_id,
          contextType: "registration",
          contextRef: current.id,
        },
        customAnswers,
        new Date().toISOString(),
      )
    : null;
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
    formPlacementId: validatedForm?.form?.placement?.id ?? null,
    sourceRef: body.sourceRef,
    waitlistClaimWindowHours: input.waitlistClaimWindowHours,
    profilePatch,
    auditActor: {
      type: input.isAdminManageJwt ? ("admin" as const) : ("user" as const),
      id: input.isAdminManageJwt ? input.actorUserId : (input.authenticatedActor?.id ?? input.actorUserId),
      action: `self_service_${body.action}`,
    },
    formSubmissionStatements: formSubmission?.statements,
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
      authority: input.isAdminManageJwt
        ? ({ kind: "event_manager", actorUserId: input.actorUserId } as const)
        : input.authenticatedActor
          ? ({ kind: "authenticated_actor", actorUserId: input.authenticatedActor.id } as const)
          : ({ kind: "registration_capability" } as const),
      allowCancelled: true,
      auditActor: {
        type: input.isAdminManageJwt ? ("admin" as const) : ("user" as const),
        id: input.isAdminManageJwt ? input.actorUserId : (input.authenticatedActor?.id ?? input.actorUserId),
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
          { ...updatePayload, eventId: current.event_id, registrationId: current.id, emailChange },
          "admin",
        )
      : await updateRegistrationByManageTokenWithEmailChange(db, {
          ...updatePayload,
          manageToken: input.manageToken,
          signingSecret: input.signingSecret,
          emailChange,
        });
    return {
      registration: result.registration,
      outboxId: result.outboxId,
      outboxIds: result.outboxIds,
      emailChanged,
    };
  }

  const result = input.isAdminManageJwt
    ? await updateRegistrationByIdWithNotification(
        db,
        { ...updatePayload, eventId: current.event_id, registrationId: current.id, notification },
        "admin",
      )
    : await updateRegistrationByManageTokenWithNotification(db, {
        ...updatePayload,
        manageToken: input.manageToken,
        signingSecret: input.signingSecret,
        notification,
      });
  return {
    registration: result.registration,
    outboxId: result.outboxId,
    outboxIds: result.outboxIds,
    emailChanged,
  };
}
