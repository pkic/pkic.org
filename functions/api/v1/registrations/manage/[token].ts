import { parseJsonBody } from "../../../../_lib/validation";
import { json, markSensitive } from "../../../../_lib/http";
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
import type { PagesContext } from "../../../../_lib/types";
import { registrationManageSchema } from "../../../../../assets/shared/schemas/api";

export async function onRequestPatch(context: PagesContext<{ token: string }>): Promise<Response> {
  const body = await parseJsonBody(context.request, registrationManageSchema);
  const config = getConfig(context.env, context.request);

  const resolved = await resolveManageToken(context.request, context.env, context.params.token);
  if (resolved instanceof Response) return resolved;
  const { registration: current, isJwt } = resolved;

  const event = current
    ? await first<{ id: string; slug: string; name: string; base_path: string | null; starts_at: string | null; settings_json: string }>(
      context.env.DB,
      "SELECT id, slug, name, base_path, starts_at, settings_json FROM events WHERE id = ?",
      [current.event_id],
    )
    : null;
  const customAnswers = body.customAnswers && event
    ? await validateCustomAnswersByPurpose(context.env.DB, {
      eventId: event.id,
      purpose: "event_registration",
      customAnswers: body.customAnswers,
    })
    : {};

  const updated = isJwt
    ? await updateRegistrationById(context.env.DB, { registrationId: current.id, action: body.action,
        attendanceType: body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined,
        dayAttendance: body.dayAttendance,
        customAnswersJson: Object.keys(customAnswers).length > 0 ? JSON.stringify(customAnswers) : null,
        sourceRef: body.sourceRef,
        waitlistClaimWindowHours: config.waitlistClaimWindowHours,
      }, "admin")
    : await updateRegistrationByManageToken(context.env.DB, {
    manageToken: context.params.token,
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
      await context.env.DB.prepare(
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
  }>(context.env.DB, "SELECT email, first_name, last_name, organization_name, job_title FROM users WHERE id = ?", [updated.user_id]);
  if (event && user) {
    const appBaseUrl = resolveAppBaseUrl(context.env);
    const manageUrl = registrationManagePageUrl(appBaseUrl, event, context.params.token);
    const templateKey = body.action === "report_unauthorized" ? "registration_unauthorized" : "registration_updated";
    const dayAttendanceRaw = await getRegistrationDayAttendance(context.env.DB, updated.id);
    const { attendanceLabel, dayAttendance } = buildAttendanceEmailData(updated.attendance_type, dayAttendanceRaw);
    const customAnswerRows = body.action !== "report_unauthorized"
      ? await getCustomAnswerRows(context.env.DB, event.id, updated.custom_answers_json)
      : [];
    const acceptedTermsText = body.action !== "report_unauthorized"
      ? await getAcceptedTermsTextForRegistration(context.env.DB, updated.id)
      : "";
    const outboxId = await queueEmail(context.env.DB, {
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
        customAnswerRows,
        acceptedTermsText: acceptedTermsText || undefined,
        status: updated.status,
        statusLabel: STATUS_LABELS[updated.status] ?? updated.status,
        manageUrl,
      },
    });

    context.waitUntil(processOutboxByIdBackground(context.env.DB, context.env, outboxId));
  }

  return json({ success: true, registration: updated });
}

export async function onRequestGet(context: PagesContext<{ token: string }>): Promise<Response> {
  const resolved = await resolveManageToken(context.request, context.env, context.params.token);
  if (resolved instanceof Response) return resolved;
  const { registration } = resolved;
  const event = await first<{ id: string; slug: string; name: string }>(
    context.env.DB,
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
  }>(context.env.DB, "SELECT id, email, first_name, last_name, organization_name, job_title, headshot_r2_key FROM users WHERE id = ?", [
    registration.user_id,
  ]);
  const eventDays = await listEventDays(context.env.DB, registration.event_id);
  const dayAttendance = await getRegistrationDayAttendance(context.env.DB, registration.id);
  const dayWaitlist = await listDayWaitlistForRegistration(context.env.DB, registration.id);

  // Derive public headshot URL from R2 key (format: headshots/{userId}/{filename})
  const appBaseUrl = resolveAppBaseUrl(context.env);
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
    context.env.DB,
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
    manageToken: context.params.token,
    eventDays: await (async () => {
      if (!event) return [];
      const registeredCounts = await countRegisteredByEventDay(context.env.DB, event.id);
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
}

export async function onRequest(context: PagesContext<{ token: string }>): Promise<Response> {
  markSensitive(context);
  if (context.request.method === "PATCH") {
    return onRequestPatch(context);
  }

  if (context.request.method === "GET") {
    return onRequestGet(context);
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } }, 405);
}
