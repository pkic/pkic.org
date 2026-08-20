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
 *   admin-only "force_status" to directly override the status field.
 */
import { json } from "../../../../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../../../../_lib/auth/admin";
import { buildEventEmailVariables, getEventBySlug } from "../../../../../../../_lib/services/events";
import { first } from "../../../../../../../_lib/db/queries";
import { parseJsonBody } from "../../../../../../../_lib/validation";
import { getConfig, resolveAppBaseUrl } from "../../../../../../../_lib/config";
import { processOutboxByIdBackground, queueEmail } from "../../../../../../../_lib/email/outbox";
import { writeAuditLog } from "../../../../../../../_lib/services/audit";
import { updateRegistrationById, changeRegistrationEmail } from "../../../../../../../_lib/services/registrations";
import { validateCustomAnswersByPurpose } from "../../../../../../../_lib/services/forms";
import { deriveEventAttendanceType, getRegistrationDayAttendance } from "../../../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../../../_lib/services/registrations/day-waitlist";
import { nowIso } from "../../../../../../../_lib/utils/time";
import { registrationManageSchema } from "../../../../../../../../assets/shared/schemas/api";
import { z } from "zod";
import { queueRegistrationStatusEmail } from "../../../../../../../_lib/services/registrations/status-notifications";
import { registrationConfirmPageUrl } from "../../../../../../../_lib/services/frontend-links";
import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../../../../../../_lib/utils/attendance";
import { requestDb, type AdminContext } from "../../../../../../../_lib/db/context";
import {
  getAcceptedTermsTextForRegistration,
  getCustomAnswerRows,
} from "../../../../../../../_lib/utils/registration-email";
import { queuedCapabilityToken } from "../../../../../../../_lib/services/capability-links";
import {
  fetchAdminRegistrationWithDetails,
  getAdminRegistrationDetail,
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

// Extend the shared manage schema with an admin-only "force_status" action.
const adminRegistrationUpdateSchema = registrationManageSchema.omit({ action: true }).extend({
  action: z.enum(["update", "cancel", "report_unauthorized", "force_status"]),
  status: z.enum(["pending_email_confirmation", "registered", "cancelled"]).optional(),
});

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const event = await getEventBySlug(requestDb(c), c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const registrationId = c.req.param("registrationId");

  const body = await parseJsonBody(c.req, adminRegistrationUpdateSchema);

  // ── force_status: directly override status without touching waitlist logic ──
  if (body.action === "force_status") {
    if (!body.status) {
      return json({ error: { code: "MISSING_STATUS", message: "status is required for force_status action" } }, 400);
    }
    const current = await fetchAdminRegistrationWithDetails(requestDb(c), event.id, registrationId);
    if (!current) {
      return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
    }
    await requestDb(c)
      .prepare("UPDATE registrations SET status = ?, updated_at = ? WHERE id = ?")
      .bind(body.status, nowIso(), registrationId)
      .run();
    await writeAuditLog(
      requestDb(c),
      "admin",
      admin.id,
      "admin_registration_force_status",
      "registration",
      registrationId,
      {
        eventId: event.id,
        from: current.status,
        to: body.status,
      },
    );

    if (current.status !== body.status) {
      const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
      const outbox = await queueRegistrationStatusEmail(requestDb(c), {
        event,
        registrationId,
        appBaseUrl,
        templateKey: body.status === "cancelled" ? "registration_unauthorized" : "registration_updated",
        subject:
          body.status === "cancelled"
            ? `Registration cancelled and data removed — ${event.name}`
            : `Registration updated for ${event.name}`,
      });
      c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outbox.outboxId));
    }

    const updated = await fetchAdminRegistrationWithDetails(requestDb(c), event.id, registrationId);
    return json({ success: true, registration: updated ? toAdminRegistrationDetail(updated) : null });
  }

  // ── update / cancel / report_unauthorized — full shared service logic ──────
  const customAnswers = body.customAnswers
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

  const updated = await updateRegistrationById(
    requestDb(c),
    {
      registrationId,
      action: body.action,
      attendanceType: body.attendanceType,
      dayAttendance: body.dayAttendance,
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
      customAnswersJson: Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null,
      sourceRef: body.sourceRef,
    },
    `admin:${admin.id}`,
  );

  // Update user PII fields when provided.
  if (body.action === "update" && (body.firstName || body.lastName || body.organizationName || body.jobTitle)) {
    const setParts: string[] = [];
    const setValues: unknown[] = [];
    if (body.firstName !== undefined) {
      setParts.push("first_name = ?");
      setValues.push(body.firstName);
    }
    if (body.lastName !== undefined) {
      setParts.push("last_name = ?");
      setValues.push(body.lastName);
    }
    if (body.organizationName !== undefined) {
      setParts.push("organization_name = ?");
      setValues.push(body.organizationName);
    }
    if (body.jobTitle !== undefined) {
      setParts.push("job_title = ?");
      setValues.push(body.jobTitle);
    }
    if (setParts.length > 0) {
      setValues.push(updated.user_id);
      await requestDb(c)
        .prepare(`UPDATE users SET ${setParts.join(", ")} WHERE id = ?`)
        .bind(...setValues)
        .run();
    }
  }

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  // ── Email change: reassign to new user and require re-confirmation ────
  let emailChanged = false;
  if (body.action === "update" && body.email) {
    const currentUser = await first<{ normalized_email: string }>(
      requestDb(c),
      "SELECT normalized_email FROM users WHERE id = ?",
      [updated.user_id],
    );
    if (currentUser && body.email.trim().toLowerCase() !== currentUser.normalized_email) {
      const emailResult = await changeRegistrationEmail(requestDb(c), {
        registrationId: updated.id,
        newEmail: body.email,
        confirmationTtlHours: config.confirmationLinkTtlHours,
        allowCancelled: true,
      });

      // Also update PII on the new user when fields were provided
      if (body.firstName || body.lastName || body.organizationName || body.jobTitle) {
        const setParts: string[] = [];
        const setValues: unknown[] = [];
        if (body.firstName !== undefined) {
          setParts.push("first_name = ?");
          setValues.push(body.firstName);
        }
        if (body.lastName !== undefined) {
          setParts.push("last_name = ?");
          setValues.push(body.lastName);
        }
        if (body.organizationName !== undefined) {
          setParts.push("organization_name = ?");
          setValues.push(body.organizationName);
        }
        if (body.jobTitle !== undefined) {
          setParts.push("job_title = ?");
          setValues.push(body.jobTitle);
        }
        if (setParts.length > 0) {
          setValues.push(emailResult.userId);
          await requestDb(c)
            .prepare(`UPDATE users SET ${setParts.join(", ")} WHERE id = ?`)
            .bind(...setValues)
            .run();
        }
      }

      await writeAuditLog(requestDb(c), "admin", admin.id, "admin_email_changed", "registration", updated.id, {
        eventId: event.id,
        previousEmail: emailResult.previousEmail,
        newEmail: emailResult.pendingEmail,
      });

      // Send confirmation email to the pending email address
      const confirmationUrl = registrationConfirmPageUrl(
        appBaseUrl,
        event,
        queuedCapabilityToken("registration_confirm", updated.id, config.confirmationLinkTtlHours * 60 * 60),
        updated.id,
      );
      const userRecord = await first<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        organization_name: string | null;
        job_title: string | null;
      }>(requestDb(c), "SELECT email, first_name, last_name, organization_name, job_title FROM users WHERE id = ?", [
        emailResult.userId,
      ]);
      if (userRecord) {
        const dayAttendanceRaw = await getRegistrationDayAttendance(requestDb(c), updated.id);
        const dayWaitlist = await listDayWaitlistForRegistration(requestDb(c), updated.id);
        const attendanceData = buildAttendanceEmailData(updated.attendance_type, dayAttendanceRaw, dayWaitlist);
        const statusData = buildRegistrationEmailStatusData("pending_email_confirmation", dayWaitlist);
        const customAnswerRows = await getCustomAnswerRows(requestDb(c), event.id, updated.custom_answers_json);
        const acceptedTermsText = await getAcceptedTermsTextForRegistration(requestDb(c), updated.id);
        const outboxId = await queueEmail(requestDb(c), {
          eventId: event.id,
          templateKey: "registration_confirm_email",
          recipientEmail: emailResult.pendingEmail,
          recipientUserId: emailResult.userId,
          messageType: "transactional",
          subject: `Confirm your email address for ${event.name}`,
          capabilityLinkValues: [confirmationUrl],
          data: {
            ...buildEventEmailVariables(event, appBaseUrl),
            firstName: userRecord.first_name ?? "",
            lastName: userRecord.last_name ?? "",
            email: emailResult.pendingEmail,
            organizationName: userRecord.organization_name ?? "",
            jobTitle: userRecord.job_title ?? "",
            attendanceLabel: attendanceData.attendanceLabel,
            dayAttendance: attendanceData.dayAttendance,
            customAnswerRows,
            dayWaitlist,
            acceptedTermsText: acceptedTermsText || undefined,
            ...statusData,
            registrationId: updated.id,
            confirmationUrl,
            manageUrl: `${appBaseUrl}/events/${event.slug}/manage`,
            shareUrl: null,
          },
        });
        c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outboxId));
      }

      emailChanged = true;
    }
  }

  if (!emailChanged) {
    const outbox = await queueRegistrationStatusEmail(requestDb(c), {
      event,
      registrationId: updated.id,
      appBaseUrl,
      templateKey: body.action === "report_unauthorized" ? "registration_unauthorized" : "registration_updated",
      subject:
        body.action === "report_unauthorized"
          ? `Registration cancelled and data removed — ${event.name}`
          : `Registration updated for ${event.name}`,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(requestDb(c), c.env, outbox.outboxId));
  }

  await writeAuditLog(requestDb(c), "admin", admin.id, "admin_registration_updated", "registration", updated.id, {
    eventId: event.id,
    action: body.action,
  });

  const result = await fetchAdminRegistrationWithDetails(requestDb(c), event.id, updated.id);
  return json({ success: true, registration: result ? toAdminRegistrationDetail(result) : null, emailChanged });
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function onRequest(c: AdminContext): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PATCH") return onRequestPatch(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
