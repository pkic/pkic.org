import type { ValidatedData } from "chanfana";
import {
  eventRegistrationDetailRouteSchema,
  eventRegistrationManagementUpdateResponseSchema,
  eventRegistrationPatchRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts-event-registration-management";
import { getConfig, resolveAppBaseUrl } from "../../../../../../_lib/config";
import type { AdminContext } from "../../../../../../_lib/db/context";
import { requestDb } from "../../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../../_lib/email/outbox";
import { json } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { deriveEventAttendanceType } from "../../../../../../_lib/services/event-days";
import {
  prepareReplaceContextFormSubmission,
  toEventFormResolutionEvent,
  validateCustomAnswersForSubmission,
} from "../../../../../../_lib/services/forms";
import {
  fetchRegistrationWithDetails,
  getRegistrationDetail,
  getRegistrationNormalizedEmail,
  toRegistrationDetail,
} from "../../../../../../_lib/services/registrations/detail";
import {
  updateRegistrationByIdWithEmailChange,
  updateRegistrationByIdWithNotification,
} from "../../../../../../_lib/services/registrations";
import { requireEventRegistrationManagement } from "../authorization";

async function handleEventRegistrationGet(
  c: AdminContext,
  data: ValidatedData<typeof eventRegistrationDetailRouteSchema>,
): Promise<Response> {
  const { db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
  const detail = await getRegistrationDetail(db, event.id, data.params.registrationId);
  if (!detail) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }
  return json(detail);
}

async function handleEventRegistrationPatch(
  c: AdminContext,
  data: ValidatedData<typeof eventRegistrationPatchRouteSchema>,
): Promise<Response> {
  const { actor, db, event } = await requireEventRegistrationManagement(c, data.params.eventSlug);
  const registrationId = data.params.registrationId;
  const body = data.body;
  const config = getConfig(c.env, c.req.raw);

  const validatedForm =
    body.customAnswers !== undefined
      ? await validateCustomAnswersForSubmission(db, {
          event: toEventFormResolutionEvent({ id: event.id, source_mode: event.source_mode }),
          purpose: "event_registration",
          customAnswers: body.customAnswers,
          context: {
            attendanceType: body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined,
            dayAttendance: body.dayAttendance,
          },
        })
      : null;
  const customAnswers = validatedForm?.answers ?? {};
  const currentRegistration = validatedForm?.form
    ? await fetchRegistrationWithDetails(db, event.id, registrationId)
    : null;
  const formSubmission =
    validatedForm?.form && currentRegistration
      ? await prepareReplaceContextFormSubmission(
          db,
          validatedForm.form,
          {
            submittedByUserId: currentRegistration.user_id,
            contextType: "registration",
            contextRef: registrationId,
          },
          customAnswers,
          new Date().toISOString(),
        )
      : null;

  const currentUser =
    body.action === "update" && body.email ? await getRegistrationNormalizedEmail(db, event.id, registrationId) : null;
  const emailChanged = Boolean(currentUser && body.email && body.email.trim().toLowerCase() !== currentUser);
  const updatePayload = {
    eventId: event.id,
    registrationId,
    action: body.action,
    attendanceType: body.attendanceType,
    dayAttendance: body.dayAttendance,
    waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    customAnswersJson: body.customAnswers !== undefined ? JSON.stringify(customAnswers) : undefined,
    formPlacementId: validatedForm?.form?.placement?.id ?? null,
    sourceRef: body.sourceRef,
    profilePatch:
      body.action === "update"
        ? {
            firstName: body.firstName,
            lastName: body.lastName,
            organizationName: body.organizationName,
            jobTitle: body.jobTitle,
          }
        : undefined,
    auditActor: { type: "admin" as const, id: actor.id, action: "event_registration_updated" },
    formSubmissionStatements: formSubmission?.statements,
  };
  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const notification = {
    event,
    appBaseUrl,
    templateKey: body.action === "report_unauthorized" ? "registration_unauthorized" : "registration_updated",
    subject:
      body.action === "report_unauthorized"
        ? `Registration cancelled and data removed — ${event.name}`
        : `Registration updated for ${event.name}`,
  };

  let updated;
  let outboxIds: string[];
  if (emailChanged && body.email) {
    const result = await updateRegistrationByIdWithEmailChange(
      db,
      {
        ...updatePayload,
        emailChange: {
          newEmail: body.email,
          confirmationTtlHours: config.confirmationLinkTtlHours,
          authority: { kind: "event_manager", actorUserId: actor.id },
          allowCancelled: true,
          auditActor: {
            type: "admin",
            id: actor.id,
            action: "event_registration_email_changed",
            eventId: event.id,
          },
          confirmationEmail: { event, appBaseUrl, confirmationTtlHours: config.confirmationLinkTtlHours },
        },
      },
      `event-manager:${actor.id}`,
    );
    updated = result.registration;
    outboxIds = result.outboxIds;
  } else {
    const result = await updateRegistrationByIdWithNotification(
      db,
      { ...updatePayload, notification },
      `event-manager:${actor.id}`,
    );
    updated = result.registration;
    outboxIds = result.outboxIds;
  }

  const rawDb = requestDb(c);
  for (const outboxId of outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(rawDb, c.env, outboxId));
  }
  const registration = await fetchRegistrationWithDetails(db, event.id, updated.id);
  return json(
    eventRegistrationManagementUpdateResponseSchema.parse({
      success: true,
      registration: registration ? toRegistrationDetail(registration) : null,
      emailChanged,
    }),
  );
}

export const EventRegistrationDetailGet = openApiRoute(eventRegistrationDetailRouteSchema, handleEventRegistrationGet);
export const EventRegistrationPatch = openApiRoute(eventRegistrationPatchRouteSchema, handleEventRegistrationPatch);
