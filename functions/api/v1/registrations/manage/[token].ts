import { parseJsonBody } from "../../../../_lib/validation";
import { handleError, json } from "../../../../_lib/http";
import {
  updateRegistrationByManageTokenWithNotification,
  updateRegistrationByManageTokenWithEmailChange,
  updateRegistrationByIdWithNotification,
  updateRegistrationByIdWithEmailChange,
} from "../../../../_lib/services/registrations";
import { resolveManageToken } from "../../../../_lib/services/manage-token";
import { processOutboxByIdBackground } from "../../../../_lib/email/outbox";
import { getConfig, resolveAppBaseUrl } from "../../../../_lib/config";
import { deriveEventAttendanceType } from "../../../../_lib/services/event-days";
import { validateCustomAnswersByPurpose } from "../../../../_lib/services/forms";
import { registrationManageSchema } from "../../../../../assets/shared/schemas/api";
import { requireInternalSecret } from "../../../../_lib/request";
import { omitCapabilitySecrets } from "../../../../_lib/services/capability-links";
import { getEventById } from "../../../../_lib/services/events";
import { getNormalizedEmailForUser } from "../../../../_lib/services/users";
import { buildRegistrationManageView } from "../../../../_lib/services/registrations/manage-view";

export async function onRequestPatch(c: any): Promise<Response> {
  try {
    const body = await parseJsonBody(c.req, registrationManageSchema);
    const config = getConfig(c.env, c.req.raw);
    const token = c.req.param("token");

    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const { registration: current, isJwt } = resolved;

    const event = await getEventById(c.env.DB, current.event_id);
    const customAnswers =
      body.customAnswers !== undefined && event
        ? await validateCustomAnswersByPurpose(c.env.DB, {
            eventId: event.id,
            purpose: "event_registration",
            customAnswers: body.customAnswers,
            context: {
              attendanceType: body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined,
              dayAttendance: body.dayAttendance,
            },
          })
        : {};
    const profilePatch =
      body.action === "update"
        ? {
            firstName: body.firstName,
            lastName: body.lastName,
            organizationName: body.organizationName,
            jobTitle: body.jobTitle,
          }
        : undefined;

    const currentUser =
      body.action === "update" && body.email ? await getNormalizedEmailForUser(c.env.DB, current.user_id) : null;
    const emailChanged = Boolean(currentUser && body.email && body.email.trim().toLowerCase() !== currentUser);
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    const updatePayload = {
      action: body.action,
      attendanceType: body.attendanceType ?? deriveEventAttendanceType(body.dayAttendance) ?? undefined,
      dayAttendance: body.dayAttendance,
      customAnswersJson: body.customAnswers !== undefined ? JSON.stringify(customAnswers) : undefined,
      sourceRef: body.sourceRef,
      waitlistClaimWindowHours: config.waitlistClaimWindowHours,
      profilePatch,
      auditActor: {
        type: isJwt ? ("admin" as const) : ("user" as const),
        id: current.user_id,
        action: `self_service_${body.action}`,
      },
    };
    const notification = {
      event,
      appBaseUrl,
      templateKey: body.action === "report_unauthorized" ? "registration_unauthorized" : "registration_updated",
      subject:
        body.action === "report_unauthorized"
          ? `Your registration for ${event.name} has been cancelled and your data removed`
          : `Registration updated for ${event.name}`,
    };
    let updated;
    let outboxId: string | null = null;
    if (isJwt) {
      if (emailChanged && body.email) {
        const result = await updateRegistrationByIdWithEmailChange(
          c.env.DB,
          {
            ...updatePayload,
            registrationId: current.id,
            emailChange: {
              newEmail: body.email,
              confirmationTtlHours: config.confirmationLinkTtlHours,
              signingSecret: requireInternalSecret(c.env),
              allowCancelled: true,
              auditActor: {
                type: "admin",
                id: current.user_id,
                action: "email_changed",
                eventId: event.id,
              },
              confirmationEmail: { event, appBaseUrl, confirmationTtlHours: config.confirmationLinkTtlHours },
            },
          },
          "admin",
        );
        updated = result.registration;
        outboxId = result.outboxId;
      } else {
        const result = await updateRegistrationByIdWithNotification(
          c.env.DB,
          { ...updatePayload, registrationId: current.id, notification },
          "admin",
        );
        updated = result.registration;
        outboxId = result.outboxId;
      }
    } else if (emailChanged && body.email) {
      const result = await updateRegistrationByManageTokenWithEmailChange(c.env.DB, {
        ...updatePayload,
        manageToken: token,
        signingSecret: requireInternalSecret(c.env),
        emailChange: {
          newEmail: body.email,
          confirmationTtlHours: config.confirmationLinkTtlHours,
          signingSecret: requireInternalSecret(c.env),
          allowCancelled: true,
          auditActor: {
            type: "user",
            id: current.user_id,
            action: "email_changed",
            eventId: event.id,
          },
          confirmationEmail: { event, appBaseUrl, confirmationTtlHours: config.confirmationLinkTtlHours },
        },
      });
      updated = result.registration;
      outboxId = result.outboxId;
    } else {
      const result = await updateRegistrationByManageTokenWithNotification(c.env.DB, {
        ...updatePayload,
        manageToken: token,
        signingSecret: requireInternalSecret(c.env),
        notification,
      });
      updated = result.registration;
      outboxId = result.outboxId;
    }
    if (outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));

    return json({
      success: true,
      registration: omitCapabilitySecrets(updated),
      emailChanged,
    });
  } catch (error) {
    return handleError(error);
  }
}

export async function onRequestGet(c: any): Promise<Response> {
  try {
    const token = c.req.param("token");
    const resolved = await resolveManageToken(c.req.raw, c.env, token);
    if (resolved instanceof Response) return resolved;
    const appBaseUrl = resolveAppBaseUrl(c.env, c.req.raw);
    return json(await buildRegistrationManageView(c.env.DB, resolved.registration, token, appBaseUrl));
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
