/**
 * Admin: manage a single registration.
 *
 * GET   /api/v1/admin/events/:eventSlug/registrations/:registrationId
 *   Fetch a single registration with user details and referral code.
 *
 * PATCH /api/v1/admin/events/:eventSlug/registrations/:registrationId
 *   Full registration update attributed to the acting admin — same service logic
 *   as the user-facing manage endpoint, but recorded under the admin's identity.
 *   Supports all standard actions (update, cancel, report_unauthorized) plus the
 *   admin-only "force_status" lifecycle transition. Active statuses still
 *   pass through day-capacity and waitlist arbitration.
 */
import { json } from "../../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../../_lib/openapi/route";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import {
  updateRegistrationByIdWithEmailChange,
  updateRegistrationByIdWithNotification,
  forceRegistrationStatus,
} from "../../../../../../../_lib/services/registrations";
import {
  prepareReplaceContextFormSubmission,
  validateCustomAnswersForSubmission,
} from "../../../../../../../_lib/services/forms";
import { deriveEventAttendanceType } from "../../../../../../../_lib/services/event-days";
import {
  adminRegistrationDetailRouteSchema,
  adminRegistrationPatchRouteSchema,
  adminRegistrationUpdateResponseSchema,
} from "../../../../../../../../assets/shared/schemas/route-contracts-admin-registrations";
import type { ValidatedData } from "chanfana";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import {
  fetchAdminRegistrationWithDetails,
  getAdminRegistrationDetail,
  getRegistrationNormalizedEmail,
  toAdminRegistrationDetail,
} from "../../../../../../../_lib/services/registrations/admin-detail";

// ── GET ───────────────────────────────────────────────────────────────────────

async function handleAdminRegistrationGet(
  c: AdminContext,
  data: ValidatedData<typeof adminRegistrationDetailRouteSchema>,
): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), data.params.eventSlug);
  const detail = await getAdminRegistrationDetail(requestDb(c), event.id, data.params.registrationId);
  if (!detail) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }
  return json(detail);
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

async function handleAdminRegistrationPatch(
  c: AdminContext,
  data: ValidatedData<typeof adminRegistrationPatchRouteSchema>,
): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const eventSlug = data.params.eventSlug;
  const registrationId = data.params.registrationId;
  const event = await getEventBySlug(requestDb(c), eventSlug);
  const config = getConfig(c.env, c.req.raw);

  const body = data.body;

  // ── force_status: override lifecycle status while preserving day capacity ──
  if (body.action === "force_status") {
    const forced = await forceRegistrationStatus(requestDb(c), {
      registrationId,
      eventId: event.id,
      status: body.status,
      actorUserId: admin.id,
      notification: {
        event,
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        templateKey: "registration_updated",
        subject:
          body.status === "cancelled"
            ? `Registration cancelled — ${event.name}`
            : `Registration updated for ${event.name}`,
      },
    });
    if (forced.outboxId) {
      c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, forced.outboxId));
    }

    const updated = await fetchAdminRegistrationWithDetails(requestDb(c), event.id, registrationId);
    return json(
      adminRegistrationUpdateResponseSchema.parse({
        success: true,
        registration: updated ? toAdminRegistrationDetail(updated) : null,
      }),
    );
  }

  // ── update / cancel / report_unauthorized — full shared service logic ──────
  const validatedForm =
    body.customAnswers !== undefined
      ? await validateCustomAnswersForSubmission(requestDb(c), {
          eventId: event.id,
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
    ? await fetchAdminRegistrationWithDetails(requestDb(c), event.id, registrationId)
    : null;
  const formSubmission =
    validatedForm?.form && currentRegistration
      ? await prepareReplaceContextFormSubmission(
          requestDb(c),
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

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
  const currentUser =
    body.action === "update" && body.email
      ? await getRegistrationNormalizedEmail(requestDb(c), event.id, registrationId)
      : null;
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
    auditActor: { type: "admin" as const, id: admin.id, action: "admin_registration_updated" },
    formSubmissionStatements: formSubmission?.statements,
  };
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
    const updateResult = await updateRegistrationByIdWithEmailChange(
      requestDb(c),
      {
        ...updatePayload,
        emailChange: {
          newEmail: body.email,
          confirmationTtlHours: config.confirmationLinkTtlHours,
          authority: { kind: "event_manager", actorUserId: admin.id },
          allowCancelled: true,
          auditActor: {
            type: "admin",
            id: admin.id,
            action: "admin_email_changed",
            eventId: event.id,
          },
          confirmationEmail: { event, appBaseUrl, confirmationTtlHours: config.confirmationLinkTtlHours },
        },
      },
      `admin:${admin.id}`,
    );
    updated = updateResult.registration;
    outboxIds = updateResult.outboxIds;
  } else {
    const updateResult = await updateRegistrationByIdWithNotification(
      requestDb(c),
      { ...updatePayload, notification },
      `admin:${admin.id}`,
    );
    updated = updateResult.registration;
    outboxIds = updateResult.outboxIds;
  }
  for (const queuedOutboxId of outboxIds) {
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, queuedOutboxId));
  }

  const result = await fetchAdminRegistrationWithDetails(requestDb(c), event.id, updated.id);
  return json(
    adminRegistrationUpdateResponseSchema.parse({
      success: true,
      registration: result ? toAdminRegistrationDetail(result) : null,
      emailChanged,
    }),
  );
}

export const AdminRegistrationDetailGet = openApiRoute(adminRegistrationDetailRouteSchema, handleAdminRegistrationGet);
export const AdminRegistrationPatch = openApiRoute(adminRegistrationPatchRouteSchema, handleAdminRegistrationPatch);
