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
import { getRegistrationDayAttendance } from "../../../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../../../_lib/services/registrations/day-waitlist";
import { nowIso } from "../../../../../../../_lib/utils/time";
import type { DatabaseLike } from "../../../../../../../_lib/types";
import { registrationManageSchema } from "../../../../../../../../assets/shared/schemas/api";
import { z } from "zod";
import { queueRegistrationStatusEmail } from "../../../../../../../_lib/services/registrations/status-notifications";
import { registrationConfirmPageUrl } from "../../../../../../../_lib/services/frontend-links";
import { buildAttendanceEmailData } from "../../../../../../../_lib/utils/attendance";
import {
  getAcceptedTermsTextForRegistration,
  getCustomAnswerRows,
} from "../../../../../../../_lib/utils/registration-email";

// ── Shared query ──────────────────────────────────────────────────────────────

interface RegistrationRow {
  id: string;
  event_id: string;
  user_id: string;
  status: string;
  attendance_type: string;
  source_type: string;
  created_at: string;
  updated_at: string;
  user_email: string | null;
  display_name: string | null;
  referral_code: string | null;
  rsvp_status: string | null;
}

async function fetchRegistrationWithDetails(
  db: DatabaseLike,
  eventId: string,
  registrationId: string,
): Promise<RegistrationRow | null> {
  return first<RegistrationRow>(
    db,
    `SELECT r.id, r.event_id, r.user_id, r.status, r.attendance_type, r.source_type,
            r.created_at, r.updated_at,
            u.email AS user_email,
            COALESCE(u.first_name || ' ' || u.last_name, u.first_name, u.email) AS display_name,
            rc.code AS referral_code,
            (SELECT response_status FROM calendar_rsvp_events WHERE registration_id = r.id ORDER BY created_at DESC LIMIT 1) AS rsvp_status
     FROM registrations r
     LEFT JOIN users u ON u.id = r.user_id
     LEFT JOIN referral_codes rc ON rc.owner_type = 'registration' AND rc.owner_id = r.id
     WHERE r.id = ? AND r.event_id = ?`,
    [registrationId, eventId],
  );
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function onRequestGet(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const registration = await fetchRegistrationWithDetails(c.env.DB, event.id, c.req.param("registrationId"));
  if (!registration) {
    return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
  }

  const [dayAttendance, dayWaitlist] = await Promise.all([
    getRegistrationDayAttendance(c.env.DB, registration.id),
    listDayWaitlistForRegistration(c.env.DB, registration.id),
  ]);

  return json({ registration, dayAttendance, dayWaitlist });
}

// ── PATCH ─────────────────────────────────────────────────────────────────────

// Extend the shared manage schema with an admin-only "force_status" action.
const adminRegistrationUpdateSchema = registrationManageSchema.omit({ action: true }).extend({
  action: z.enum(["update", "cancel", "report_unauthorized", "force_status"]),
  status: z.enum(["pending_email_confirmation", "registered", "waitlisted", "cancelled"]).optional(),
});

export async function onRequestPatch(c: any): Promise<Response> {
  const admin = await requireAdminFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const config = getConfig(c.env, c.req.raw);
  const registrationId = c.req.param("registrationId");

  const body = await parseJsonBody(c.req, adminRegistrationUpdateSchema);

  // ── force_status: directly override status without touching waitlist logic ──
  if (body.action === "force_status") {
    if (!body.status) {
      return json({ error: { code: "MISSING_STATUS", message: "status is required for force_status action" } }, 400);
    }
    const current = await fetchRegistrationWithDetails(c.env.DB, event.id, registrationId);
    if (!current) {
      return json({ error: { code: "REGISTRATION_NOT_FOUND", message: "Registration not found" } }, 404);
    }
    await c.env.DB.prepare("UPDATE registrations SET status = ?, updated_at = ? WHERE id = ?")
      .bind(body.status, nowIso(), registrationId)
      .run();
    await writeAuditLog(
      c.env.DB,
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
      const outbox = await queueRegistrationStatusEmail(c.env.DB, {
        event,
        registrationId,
        appBaseUrl,
        templateKey: body.status === "cancelled" ? "registration_unauthorized" : "registration_updated",
        subject:
          body.status === "cancelled"
            ? `Registration cancelled and data removed — ${event.name}`
            : `Registration updated for ${event.name}`,
      });
      c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outbox.outboxId));
    }

    const updated = await fetchRegistrationWithDetails(c.env.DB, event.id, registrationId);
    return json({ success: true, registration: updated });
  }

  // ── update / cancel / report_unauthorized — full shared service logic ──────
  const customAnswers = body.customAnswers
    ? await validateCustomAnswersByPurpose(c.env.DB, {
        eventId: event.id,
        purpose: "event_registration",
        customAnswers: body.customAnswers,
      })
    : {};

  const updated = await updateRegistrationById(
    c.env.DB,
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
      await c.env.DB.prepare(`UPDATE users SET ${setParts.join(", ")} WHERE id = ?`)
        .bind(...setValues)
        .run();
    }
  }

  const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);

  // ── Email change: reassign to new user and require re-confirmation ────
  let emailChanged = false;
  if (body.action === "update" && body.email) {
    const currentUser = await first<{ normalized_email: string }>(
      c.env.DB,
      "SELECT normalized_email FROM users WHERE id = ?",
      [updated.user_id],
    );
    if (currentUser && body.email.trim().toLowerCase() !== currentUser.normalized_email) {
      const emailResult = await changeRegistrationEmail(c.env.DB, {
        registrationId: updated.id,
        newEmail: body.email,
        confirmationTtlHours: config.manageTokenTtlHours,
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
          await c.env.DB.prepare(`UPDATE users SET ${setParts.join(", ")} WHERE id = ?`)
            .bind(...setValues)
            .run();
        }
      }

      await writeAuditLog(c.env.DB, "admin", admin.id, "admin_email_changed", "registration", updated.id, {
        eventId: event.id,
        previousEmail: emailResult.previousEmail,
        newEmail: emailResult.pendingEmail,
      });

      // Send confirmation email to the pending email address
      const confirmationUrl = registrationConfirmPageUrl(appBaseUrl, event, emailResult.confirmationToken);
      const userRecord = await first<{
        email: string;
        first_name: string | null;
        last_name: string | null;
        organization_name: string | null;
        job_title: string | null;
      }>(c.env.DB, "SELECT email, first_name, last_name, organization_name, job_title FROM users WHERE id = ?", [
        emailResult.userId,
      ]);
      if (userRecord) {
        const dayAttendanceRaw = await getRegistrationDayAttendance(c.env.DB, updated.id);
        const dayWaitlist = await listDayWaitlistForRegistration(c.env.DB, updated.id);
        const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(
          updated.attendance_type,
          dayAttendanceRaw,
          dayWaitlist,
        );
        const customAnswerRows = await getCustomAnswerRows(c.env.DB, event.id, updated.custom_answers_json);
        const acceptedTermsText = await getAcceptedTermsTextForRegistration(c.env.DB, updated.id);
        const outboxId = await queueEmail(c.env.DB, {
          eventId: event.id,
          templateKey: "registration_confirm_email",
          recipientEmail: emailResult.pendingEmail,
          recipientUserId: emailResult.userId,
          messageType: "transactional",
          subject: `Confirm your email address for ${event.name}`,
          data: {
            ...buildEventEmailVariables(event, appBaseUrl),
            firstName: userRecord.first_name ?? "",
            lastName: userRecord.last_name ?? "",
            email: emailResult.pendingEmail,
            organizationName: userRecord.organization_name ?? "",
            jobTitle: userRecord.job_title ?? "",
            attendanceLabel,
            dayAttendance,
            customAnswerRows,
            dayWaitlist,
            acceptedTermsText: acceptedTermsText || undefined,
            status: "pending_email_confirmation",
            registrationId: updated.id,
            confirmationUrl,
            manageUrl: `${appBaseUrl}/events/${event.slug}/manage`,
            shareUrl: null,
          },
        });
        c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
      }

      emailChanged = true;
    }
  }

  if (!emailChanged) {
    const outbox = await queueRegistrationStatusEmail(c.env.DB, {
      event,
      registrationId: updated.id,
      appBaseUrl,
      templateKey: body.action === "report_unauthorized" ? "registration_unauthorized" : "registration_updated",
      subject:
        body.action === "report_unauthorized"
          ? `Registration cancelled and data removed — ${event.name}`
          : `Registration updated for ${event.name}`,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outbox.outboxId));
  }

  await writeAuditLog(c.env.DB, "admin", admin.id, "admin_registration_updated", "registration", updated.id, {
    eventId: event.id,
    action: body.action,
  });

  const result = await fetchRegistrationWithDetails(c.env.DB, event.id, updated.id);
  return json({ success: true, registration: result, emailChanged });
}

// ── Router ────────────────────────────────────────────────────────────────────

export async function onRequest(c: any): Promise<Response> {
  if (c.req.raw.method === "GET") return onRequestGet(c);
  if (c.req.raw.method === "PATCH") return onRequestPatch(c);
  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
