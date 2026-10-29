import type { EventAffiliationContext } from "./identities/event-affiliation-context";
import type { AttendeeRegistrationFields } from "../../../assets/shared/schemas/registration";
import type { DatabaseLike, StatementLike } from "../types";
import { AppError } from "../errors";
import { deriveEventAttendanceType } from "./event-days";
import { prepareActiveTermsSnapshotGuard, validateRequiredConsents } from "./consent";
import { prepareRequiredTerms, type EventTermRecord } from "./events";
import { batchRows } from "../db/pagination";
import {
  toEventFormResolutionEvent,
  prepareEventFormDefinitionRead,
  validateCustomAnswersForResolvedForm,
} from "./forms";
import type { InviteRecord } from "./invites";
import { prepareRegistrationSubmission } from "./registration-submission";
import type { VerifiedRegistrationIdentityContext } from "./registrations";
import type { EventFormResolutionEvent } from "./forms";

export async function prepareValidatedAttendeeRegistration(
  db: DatabaseLike,
  input: AttendeeRegistrationFields,
  options: {
    invite: InviteRecord | null;
    sourceType: string;
    sourceRef?: string | null;
    referredByCode?: string | null;
    ip: string | null;
    userAgent: string | null;
    signingSecret: string;
    pendingConfirmationDeadlineHours: number;
    confirmationTtlHours: number;
    referralCodeLength: number;
    verifiedIdentity?: VerifiedRegistrationIdentityContext;
    affiliationContext?: EventAffiliationContext;
    mailboxVerified?: boolean;
    authorizationGuards?: readonly StatementLike[];
    /** Every registration flow supplies the loaded event so portal isolation cannot be skipped. */
    event: Pick<EventFormResolutionEvent, "id"> & { source_mode: string | null | undefined };
  },
) {
  const event = toEventFormResolutionEvent(options.event);
  const attendanceType = input.attendanceType ?? deriveEventAttendanceType(input.dayAttendance);
  if (!attendanceType) {
    throw new AppError(400, "ATTENDANCE_REQUIRED", "attendanceType or dayAttendance is required");
  }

  const formRead = prepareEventFormDefinitionRead(db, event, "event_registration");
  const [termsResult, ...formResults] = await db.batch([
    prepareRequiredTerms(db, event.id, "attendee"),
    ...formRead.statements,
  ]);
  const requiredTerms = batchRows<EventTermRecord>(termsResult);
  await validateRequiredConsents(requiredTerms, input.consents);
  const form = formRead.decode(formResults);
  const validatedForm = validateCustomAnswersForResolvedForm(form, {
    customAnswers: input.customAnswers,
    context: { attendanceType, dayAttendance: input.dayAttendance },
  });
  const customAnswers = validatedForm.answers;

  const prepared = await prepareRegistrationSubmission(db, {
    eventId: event.id,
    user: {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
    },
    attendanceType,
    dayAttendance: input.dayAttendance,
    sourceType: options.sourceType,
    sourceRef: options.sourceRef,
    customAnswersJson: Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null,
    formPlacementId: validatedForm.form?.placement?.id ?? null,
    formDefinition: validatedForm.form,
    formAnswers: customAnswers,
    referredByCode: options.referredByCode,
    invite: options.invite,
    consents: input.consents,
    ip: options.ip,
    userAgent: options.userAgent,
    pendingConfirmationDeadlineHours: options.pendingConfirmationDeadlineHours,
    signingSecret: options.signingSecret,
    confirmationTtlHours: options.confirmationTtlHours,
    referralCodeLength: options.referralCodeLength,
    authorizationGuards: options.authorizationGuards,
    termsSnapshotGuard: prepareActiveTermsSnapshotGuard(db, event.id, requiredTerms),
    verifiedIdentity: options.verifiedIdentity,
    affiliationContext: options.affiliationContext,
    mailboxVerified: options.mailboxVerified,
  });
  return { prepared, requiredTerms, formResponse: validatedForm };
}
