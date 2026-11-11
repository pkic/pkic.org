import { AppError } from "../../errors";
import { registrationManageSchema } from "../../../../assets/shared/schemas/registration";
import type { DatabaseLike } from "../../types";
import { getEventById } from "../events";
import {
  prepareReplaceContextFormSubmission,
  toEventFormResolutionEvent,
  validateCustomAnswersForSubmission,
} from "../forms";
import type { z } from "zod";
import type { RegistrationRecord } from "./types";
import type { ParticipantAuthority } from "../participant-authority";
import { withdrawRegistrationSponsorSharing } from "./sponsor-sharing";
import { updateRegistrationByIdWithNotification, updateRegistrationByManageTokenWithNotification } from "./update";

type RegistrationManageBody = z.infer<typeof registrationManageSchema>;

export interface ManageRegistrationUpdateInput {
  registration: RegistrationRecord;
  manageToken: ParticipantAuthority;
  isAdminManageJwt: boolean;
  authenticatedActor: { kind: "user"; id: string } | null;
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
}

/**
 * Executes the registration self-service command, including form validation,
 * profile changes, audit context, and the durable notification intent.
 */
export async function updateManagedRegistration(
  db: DatabaseLike,
  input: ManageRegistrationUpdateInput,
): Promise<ManageRegistrationUpdateResult> {
  const { body, registration: current } = input;
  if (body.action === "withdraw_sponsor_sharing") {
    if (input.isAdminManageJwt || (input.authenticatedActor && input.authenticatedActor.id !== current.user_id))
      throw new AppError(
        403,
        "REGISTRATION_CONSENT_AUTHORITY_REQUIRED",
        "Withdraw sharing using your own registration link or session.",
      );
    const registration = await withdrawRegistrationSponsorSharing(db, input.manageToken, input.signingSecret, current);
    return { registration, outboxId: null, outboxIds: [] };
  }
  const event = await getEventById(db, current.event_id);
  const validatedForm =
    body.customAnswers !== undefined
      ? await validateCustomAnswersForSubmission(db, {
          event: toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
          purpose: "event_registration",
          customAnswers: body.customAnswers,
          context: { dayAttendance: body.dayAttendance },
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
        }
      : undefined;

  const updatePayload = {
    action: body.action,
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
  };
}
