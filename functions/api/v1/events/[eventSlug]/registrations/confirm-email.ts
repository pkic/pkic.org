import type { ValidatedData } from "chanfana";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json } from "../../../../../_lib/http";
import { getConfig, resolveAppBaseUrl } from "../../../../../_lib/config";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { confirmRegistrationWithNotification } from "../../../../../_lib/services/registrations/confirmation-workflow";
import { getRegistrationDayAttendance } from "../../../../../_lib/services/event-days";
import { listDayWaitlistForRegistration } from "../../../../../_lib/services/registrations/day-waitlist";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { registrationConfirmResponseSchema } from "../../../../../../assets/shared/schemas/registration";
import {
  registrationConfirmEmailGetRouteSchema,
  registrationConfirmEmailPostRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { requireInternalSecret } from "../../../../../_lib/request";
import type { RegistrationConfirmOrganization } from "../../../../../../assets/shared/schemas/registration";

async function confirmRegistration(
  c: any,
  eventSlug: string,
  token: string,
  registrationId?: string | null,
  organization?: RegistrationConfirmOrganization,
): Promise<Response> {
  const config = getConfig(c.env, c.req.raw);
  const event = await getEventBySlug(c.env.DB, eventSlug);
  const result = await confirmRegistrationWithNotification(c.env.DB, {
    event,
    token,
    registrationId,
    waitlistClaimWindowHours: config.waitlistClaimWindowHours,
    confirmationTtlHours: config.confirmationLinkTtlHours,
    signingSecret: requireInternalSecret(c.env),
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    rsvpEmail: c.env.RSVP_EMAIL,
    organization,
  });
  c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
  const [dayAttendance, dayWaitlist] = await Promise.all([
    getRegistrationDayAttendance(c.env.DB, result.registration.id),
    listDayWaitlistForRegistration(c.env.DB, result.registration.id),
  ]);
  return json(
    registrationConfirmResponseSchema.parse({
      success: true,
      stage: result.stage,
      status: result.registration.status,
      shareUrl: result.shareUrl,
      manageUrl: result.manageUrl,
      manageToken: result.manageToken,
      organizationOutcome: result.organizationOutcome,
      dayAttendance,
      dayWaitlist,
    }),
  );
}

async function handleConfirmRegistrationPost(
  c: any,
  data: ValidatedData<typeof registrationConfirmEmailPostRouteSchema>,
): Promise<Response> {
  return confirmRegistration(c, data.params.eventSlug, data.body.token, data.body.id, data.body.organization);
}

async function handleConfirmRegistrationGet(
  c: any,
  data: ValidatedData<typeof registrationConfirmEmailGetRouteSchema>,
): Promise<Response> {
  return confirmRegistration(c, data.params.eventSlug, data.query.token, data.query.id);
}

export const EventsEventSlugRegistrationsConfirmEmailGet = openApiRoute(
  registrationConfirmEmailGetRouteSchema,
  handleConfirmRegistrationGet,
);
export const EventsEventSlugRegistrationsConfirmEmailPost = openApiRoute(
  registrationConfirmEmailPostRouteSchema,
  handleConfirmRegistrationPost,
);
