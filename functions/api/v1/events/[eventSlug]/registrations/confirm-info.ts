import type { ValidatedData } from "chanfana";
import { json } from "../../../../../_lib/http";
import { verifyDatabaseCapability } from "../../../../../_lib/services/capability-links";
import { requireInternalSecret } from "../../../../../_lib/request";
import { getRegistrationConfirmationInfo } from "../../../../../_lib/services/registrations/confirmation-info";
import { requestDb } from "../../../../../_lib/db/context";

import {
  registrationConfirmInfoResponseSchema,
  type RegistrationConfirmInfoResponse,
} from "../../../../../../assets/shared/schemas/registration";
import { registrationConfirmInfoGetRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-registrations";
import { openApiRoute } from "../../../../../_lib/openapi/route";

/**
 * GET /api/v1/events/:eventSlug/registrations/confirm-info?token=...
 *
 * Read-only preview endpoint for the email-confirmation landing page.
 * Returns the attendee's first name and event name for the given pending
 * confirmation token so the page can display a personalised greeting before
 * the user clicks Confirm — without embedding PII in the URL.
 *
 * Deliberately returns null values (not an error) when the token is absent
 * or not found; the page degrades gracefully and the POST confirm step will
 * surface any real validation errors.
 */
export async function onRequestGet(
  c: any,
  data?: ValidatedData<typeof registrationConfirmInfoGetRouteSchema>,
): Promise<Response> {
  c.set("sensitive", true);
  const query = data?.query ?? Object.fromEntries(new URL(c.req.raw.url).searchParams);
  const token = typeof query.token === "string" ? query.token : null;
  const registrationId = typeof query.id === "string" ? query.id : null;

  const empty: RegistrationConfirmInfoResponse = {
    firstName: null,
    lastName: null,
    email: null,
    organizationName: null,
    eventName: null,
    expired: false,
    recoverable: false,
  };

  if (!token || token.trim().length === 0) {
    return json(registrationConfirmInfoResponseSchema.parse(empty));
  }

  const verified = await verifyDatabaseCapability({
    db: requestDb(c),
    signingSecret: requireInternalSecret(c.env),
    purpose: "registration_confirm",
    token: token.trim(),
  });
  const resourceId = verified.ok ? verified.resourceId : registrationId;

  if (!resourceId || (registrationId && verified.ok && registrationId !== verified.resourceId)) {
    return json(registrationConfirmInfoResponseSchema.parse(empty));
  }

  const row = await getRegistrationConfirmationInfo(requestDb(c), c.req.param("eventSlug"), resourceId);

  if (!row) {
    return json(registrationConfirmInfoResponseSchema.parse(empty));
  }

  const tokenMatches = verified.ok;

  return json(
    registrationConfirmInfoResponseSchema.parse({
      firstName: tokenMatches ? (row.first_name ?? null) : null,
      lastName: tokenMatches ? (row.last_name ?? null) : null,
      email: tokenMatches ? (row.email ?? null) : null,
      organizationName: tokenMatches ? (row.organization_name ?? null) : null,
      eventName: row.event_name,
      expired: !tokenMatches,
      recoverable: !tokenMatches,
    } satisfies RegistrationConfirmInfoResponse),
  );
}

export const EventsEventSlugRegistrationsConfirmInfoGet = openApiRoute(
  registrationConfirmInfoGetRouteSchema,
  onRequestGet,
  (c: any) => c.set("sensitive", true),
);
