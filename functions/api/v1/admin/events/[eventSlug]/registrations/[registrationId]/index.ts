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
import { dispatchRequestMethod, json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { getEventBySlug } from "../../../../../../../_lib/services/events";
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../../../_lib/email/outbox";
import {
  updateRegistrationByIdWithEmailChange,
  updateRegistrationByIdWithNotification,
  forceRegistrationStatus,
} from "../../../../../../../_lib/services/registrations";
import { validateCustomAnswersByPurpose } from "../../../../../../../_lib/services/forms";
import { deriveEventAttendanceType } from "../../../../../../../_lib/services/event-days";
import { adminRegistrationUpdateSchema } from "../../../../../../../../assets/shared/schemas/route-contracts-admin-registrations";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import {
  fetchAdminRegistrationWithDetails,
  getAdminRegistrationDetail,
  getRegistrationNormalizedEmail,
  toAdminRegistrationDetail,
} from "../../../../../../../_lib/services/registrations/admin-detail";

// ── GET ───────────────────────────────────────────────────────────────────────

export async function onRequestGet(c: AdminContext): Promise<Response> {
  await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const detail = await getAdminRegistrationDetail(requestDb(c), event.id, c.req.param("registrationId"));
  if (!detail) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }
  return json(detail);
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const registrationId = c.req.param("registrationId");

  const body = await parseJsonBody(c.req, adminRegistrationUpdateSchema);

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
    return json({ success: true, registration: updated ? toAdminRegistrationDetail(updated) : null });
  }

  // ── update / cancel / report_unauthorized — full shared service logic ──────
  const customAnswers =
    body.customAnswers !== undefined
      ? await validateCustomAnswersByPurpose(requestDb(c), {
          eventId: event.id,
          purpose: "event_registration",
          customAnswers: body.customAnswers,
          context: {
            attendanceType: body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined,
            dayAttendance: body.dayAttendance,
          },
        })
      : {};

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
  let outboxId: string | null;
  if (emailChanged && body.email) {
    const updateResult = await updateRegistrationByIdWithEmailChange(
      requestDb(c),
      {
        ...updatePayload,
        emailChange: {
          newEmail: body.email,
          confirmationTtlHours: config.confirmationLinkTtlHours,
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
    outboxId = updateResult.outboxId;
  } else {
    const updateResult = await updateRegistrationByIdWithNotification(
      requestDb(c),
      { ...updatePayload, notification },
      `admin:${admin.id}`,
    );
    updated = updateResult.registration;
    outboxId = updateResult.outboxId;
  }
  if (outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outboxId));

  const result = await fetchAdminRegistrationWithDetails(requestDb(c), event.id, updated.id);
  return json({ success: true, registration: result ? toAdminRegistrationDetail(result) : null, emailChanged });
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet, PATCH: onRequestPatch });
}
