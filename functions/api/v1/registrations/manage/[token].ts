import { parseJsonBody } from "../../../../_lib/validation";
import { handleError, json } from "../../../../_lib/http";
import { updateRegistrationByManageToken, updateRegistrationById } from "../../../../_lib/services/registrations";
import { resolveManageToken } from "../../../../_lib/services/manage-token";
import { first } from "../../../../_lib/db/queries";
import { processOutboxByIdBackground, queueEmail } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { countRegisteredByEventDay, deriveEventAttendanceType, getRegistrationDayAttendance, listEventDays, resolveAttendanceOptions } from "../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../_lib/services/registrations/day-waitlist";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { registrationManagePageUrl } from "../../../../_lib/services/frontend-links";
import { buildAttendanceEmailData, STATUS_LABELS } from "../../../../_lib/utils/attendance";
import { getAcceptedTermsTextForRegistration, getCustomAnswerRows } from "../../../../_lib/utils/registration-email";
import { buildEventEmailVariables } from "../../../../_lib/services/events";
import { registrationManageSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPatch(c: any): Promise<Response> {
  try {
    const body = await parseJsonBody(c.req, registrationManageSchema);
    const config = getConfig(c.env, c.req.raw);
    const token = c.req.param("token");

    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const { registration: current, isJwt } = resolved;

    const event = current
      ? await first<{ id: string; slug: string; name: string; base_path: string | null; starts_at: string | null; settings_json: string }>(
        c.env.DB,
        "SELECT id, slug, name, base_path, starts_at, settings_json FROM events WHERE id = ?",
        [current.event_id],
      )
      : null;
    const customAnswers = body.customAnswers && event
      ? await validateCustomAnswersByPurpose(c.env.DB, {
        eventId: event.id,
        purpose: "event_registration",
        customAnswers: body.customAnswers,
      })
      : {};

    const updated = isJwt
      ? await updateRegistrationById(c.env.DB, { registrationId: current.id, action: body.action,
          attendanceType: body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined,
          dayAttendance: body.dayAttendance,
          customAnswersJson: Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null,
          sourceRef: body.sourceRef,
          waitlistClaimWindowHours: config.waitlistClaimWindowHours,
        }, "admin")
      : await updateRegistrationByManageToken(c.env.DB, {
      manageToken: token,
      action: body.action,
      attendanceType: body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined,
      dayAttendance: body.dayAttendance,
      customAnswersJson: Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null,
      sourceRef: body.sourceRef,
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    });

    // Update user PII when provided on update action (name, org, job title).
    if (body.action === "update" && (body.firstName || body.lastName || body.organizationName || body.jobTitle)) {
      const setParts: string[] = [];
      const setValues: unknown[] = [];
      if (body.firstName !== undefined) { setParts.push("first_name = ?"); setValues.push(body.firstName); }
      if (body.lastName !== undefined) { setParts.push("last_name = ?"); setValues.push(body.lastName); }
      if (body.organizationName !== undefined) { setParts.push("organization_name = ?"); setValues.push(body.organizationName); }
      if (body.jobTitle !== undefined) { setParts.push("job_title = ?"); setValues.push(body.jobTitle); }
      if (setParts.length > 0) {
        setValues.push(updated.user_id);
        await c.env.DB.prepare(
          `UPDATE users SET ${setParts.join(", ")} WHERE id = ?`
        ).bind(...setValues).run();
      }
    }

    const user = await first<{
      email: string;
      first_name: string | null;
      last_name: string | null;
      organization_name: string | null;
      job_title: string | null;
    }>(c.env.DB, "SELECT email, first_name, last_name, organization_name, job_title FROM users WHERE id = ?", [updated.user_id]);
    if (event && user) {
      const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
      const manageUrl = registrationManagePageUrl(appBaseUrl, event, token);
      const templateKey = body.action === "report_unauthorized" ? "registration_unauthorized" : "registration_updated";
      const dayAttendanceRaw = await getRegistrationDayAttendance(c.env.DB, updated.id);
      const dayWaitlist = await listDayWaitlistForRegistration(c.env.DB, updated.id);
      const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(updated.attendance_type, dayAttendanceRaw, dayWaitlist);
      const customAnswerRows = body.action !== "report_unauthorized"
        ? await getCustomAnswerRows(c.env.DB, event.id, updated.custom_answers_json)
        : [];
      const acceptedTermsText = body.action !== "report_unauthorized"
        ? await getAcceptedTermsTextForRegistration(c.env.DB, updated.id)
        : "";
      const outboxId = await queueEmail(c.env.DB, {
        eventId: event.id,
        templateKey,
        recipientEmail: user.email,
        recipientUserId: updated.user_id,
        messageType: "transactional",
        subject: body.action === "report_unauthorized"
          ? `Your registration for ${event.name} has been cancelled and your data removed`
          : `Registration updated for ${event.name}`,
        data: {
          ...buildEventEmailVariables(event, appBaseUrl),
          firstName: user.first_name ?? "",
          lastName: user.last_name ?? "",
          email: user.email,
          organizationName: user.organization_name ?? "",
          jobTitle: user.job_title ?? "",
          attendanceType: updated.attendance_type,
          attendanceLabel,
          dayAttendance,
          dayWaitlist,
          customAnswerRows,
          acceptedTermsText: acceptedTermsText || undefined,
          status: updated.status,
          statusLabel: STATUS_LABELS[updated.status] ?? updated.status,
          manageUrl,
        },
      });

      c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
    }

    return json({ success: true, registration: updated });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestGet(c: any): Promise<Response> {
  try {
    const token = c.req.param("token");
    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const { registration } = resolved;
    const event = await first<{ id: string; slug: string; name: string }>(
      c.env.DB,
      "SELECT id, slug, name FROM events WHERE id = ?",
      [registration.event_id],
    );
    const user = await first<{
      id: string;
      email: string;
      first_name: string | null;
      last_name: string | null;
      organization_name: string | null;
      job_title: string | null;
      headshot_r2_key: string | null;
    }>(c.env.DB, "SELECT id, email, first_name, last_name, organization_name, job_title, headshot_r2_key FROM users WHERE id = ?", [
      registration.user_id,
    ]);
    const eventDays = await listEventDays(c.env.DB, registration.event_id);
    const dayAttendance = await getRegistrationDayAttendance(c.env.DB, registration.id);
    const dayWaitlist = await listDayWaitlistForRegistration(c.env.DB, registration.id);

    // Derive public headshot URL from R2 key (format: headshots/{userId}/{filename})
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    let headshotUrl: string | null = null;
    if (user?.headshot_r2_key) {
      const parts = user.headshot_r2_key.split("/");
      if (parts.length >= 3) {
        const filename = parts.slice(2).join("/");
        headshotUrl = `${appBaseUrl}/api/v1/headshots/${user.id}/${filename}`;
      }
    }

    // Retrieve the attendee's personal referral / share link for this registration
    const referralRow = await first<{ code: string }>(
      c.env.DB,
      "SELECT code FROM referral_codes WHERE owner_type = 'registration' AND owner_id = ? LIMIT 1",
      [registration.id],
    );
    const shareUrl = referralRow ? `${appBaseUrl}/r/${referralRow.code}` : null;

    return json({
      success: true,
      registration: {
        ...registration,
        custom_answers: registration.custom_answers_json ? JSON.parse(registration.custom_answers_json) : null,
      },
      event,
      user,
      headshotUrl,
      shareUrl,
      manageToken: token,
      eventDays: await (async () => {
        if (!event) return [];
        const registeredCounts = await countRegisteredByEventDay(c.env.DB, event.id);
        return eventDays.map((day) => ({
          dayDate: day.day_date,
          label: day.label,
          inPersonCapacity: day.in_person_capacity,
          sortOrder: day.sort_order,
          attendanceOptions: resolveAttendanceOptions(day).map((option) => {
            const capacity = option.capacity ?? null;
            const registered = registeredCounts.get(day.id)?.get(option.value) ?? 0;
            const spotsRemainingPercent =
              capacity != null && capacity > 0
                ? Math.round(((capacity - registered) / capacity) * 100)
                : null;
            return { value: option.value, label: option.label, spotsRemainingPercent };
          }),
        }));
      })(),
      dayAttendance,
      dayWaitlist,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequest(c: any): Promise<Response> {
  c.set("sensitive", true);
  if (c.req.raw.method === "PATCH") {
    return onRequestPatch(c);
  }

  if (c.req.raw.method === "GET") {
    return onRequestGet(c);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
