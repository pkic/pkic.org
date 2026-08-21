import type { z } from "zod";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { parseJsonBody } from "../../../../../_lib/validation";
import { dispatchRequestMethod, json } from "../../../../../_lib/http";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { confirmRegistrationWithNotification } from "../../../../../_lib/services/registrations/confirmation-workflow";
import { getRegistrationDayAttendance } from "../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../_lib/services/registrations/day-waitlist";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { registrationConfirmSchema } from "../../../../../../assets/shared/schemas/registration";
import {
  registrationConfirmEmailGetRouteSchema,
  registrationConfirmEmailPostRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requireInternalSecret } from "../../../../../_lib/request";

async function confirmRegistration(c: any, token: string, registrationId?: string | null): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const event = await getEventBySlug(c.env.DB, c.req.param("eventSlug"));
  const result = await confirmRegistrationWithNotification(c.env.DB, {
    event,
    token,
    registrationId,
    waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    signingSecret: requireInternalSecret(c.env),
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    rsvpEmail: c.env.RSVP_EMAIL,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
  const [dayAttendance, dayWaitlist] = await Promise.all([
    getRegistrationDayAttendance(c.env.DB, result.registration.id),
    listDayWaitlistForRegistration(c.env.DB, result.registration.id),
  ]);
  return json({
    success: true,
    status: result.registration.status,
    shareUrl: result.shareUrl,
    manageUrl: result.manageUrl,
    manageToken: result.manageToken,
    dayAttendance,
    dayWaitlist,
  });
}

export async function onRequestPost(
  c: any,
  data?: { body: z.infer<typeof registrationConfirmSchema> },
): Promise<Response> {
  const body = data?.body ?? (await parseJsonBody(c.req, registrationConfirmSchema));
  return confirmRegistration(c, body.token, body.id);
}

export async function onRequestGet(c: any): Promise<Response> {
  const params = new URL(c.req.raw.url).searchParams;
  const token = params.get("token");
  if (!token) {
    return json({ error: { code: "TOKEN_REQUIRED", message: "token query parameter is required" } }, 400);
  }
  const parsed = registrationConfirmSchema.safeParse({
    token,
    id: params.get("id") ?? undefined,
  });
  if (!parsed.success) {
    return json({ error: { code: "VALIDATION_ERROR", message: "Invalid token" } }, 400);
  }
  return confirmRegistration(c, parsed.data.token, parsed.data.id);
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet, POST: onRequestPost });
}

export const EventsEventSlugRegistrationsConfirmEmailGet = openApiRoute(
  registrationConfirmEmailGetRouteSchema,
  onRequestGet,
);
export const EventsEventSlugRegistrationsConfirmEmailPost = openApiRoute(
  registrationConfirmEmailPostRouteSchema,
  onRequestPost,
);
