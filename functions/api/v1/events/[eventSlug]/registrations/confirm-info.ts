import type { ValidatedData } from "chanfana";
import { json } from "../../../../../_lib/http";
import { parseCapabilityToken, verifyCapabilityToken } from "../../../../../_lib/auth/capability-token";
import { registrationConfirmationMailboxProof } from "../../../../../_lib/services/registrations/email-proof";
import { workEmailDomain } from "../../../../../_lib/email-domains/classification";
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
async function handleConfirmInfo(
  c: any,
  data: ValidatedData<typeof registrationConfirmInfoGetRouteSchema>,
): Promise<Response> {
  c.set("sensitive", true);
  const token = data.query.token ?? null;
  const registrationId = data.query.id ?? null;

  const empty: RegistrationConfirmInfoResponse = {
    firstName: null,
    lastName: null,
    email: null,
    organizationName: null,
    asksOrganization: false,
    eventName: null,
    expired: false,
    recoverable: false,
  };

  if (!token || token.trim().length === 0) {
    return json(registrationConfirmInfoResponseSchema.parse(empty));
  }

  const parsed = parseCapabilityToken(token.trim(), "registration_confirm");
  const resourceId = parsed?.resourceId ?? registrationId;

  if (!resourceId || (registrationId && parsed && registrationId !== parsed.resourceId)) {
    return json(registrationConfirmInfoResponseSchema.parse(empty));
  }

  const row = await getRegistrationConfirmationInfo(requestDb(c), data.params.eventSlug, resourceId);

  if (!row) {
    return json(registrationConfirmInfoResponseSchema.parse(empty));
  }

  const verified = row.confirmation_link_secret
    ? await verifyCapabilityToken({
        signingSecret: requireInternalSecret(c.env),
        purpose: "registration_confirm",
        token: token.trim(),
        linkSecret: row.confirmation_link_secret,
      })
    : { ok: false as const, reason: "invalid" as const };
  const tokenMatches =
    verified.ok &&
    (!row.pending_confirmation_deadline_at || row.pending_confirmation_deadline_at > new Date().toISOString());
  const work = tokenMatches && row.email ? Boolean(workEmailDomain(row.email)) : false;
  const organizationProof =
    tokenMatches && verified.ok && work && row.email
      ? await registrationConfirmationMailboxProof(
          requireInternalSecret(c.env),
          {
            eventId: row.event_id,
            email: row.email,
            unaffiliatedAttestation: false,
            binding: { userId: row.user_id, registrationId: resourceId, revision: row.transition_revision },
          },
          verified.expiresAt,
        )
      : undefined;

  return json(
    registrationConfirmInfoResponseSchema.parse({
      firstName: tokenMatches ? (row.first_name ?? null) : null,
      lastName: tokenMatches ? (row.last_name ?? null) : null,
      email: tokenMatches ? (row.email ?? null) : null,
      organizationName: tokenMatches ? (row.organization_name ?? null) : null,
      asksOrganization: work,
      organizationProof,
      eventName: row.event_name,
      expired: !tokenMatches,
      recoverable: !tokenMatches,
    } satisfies RegistrationConfirmInfoResponse),
  );
}

export const EventsEventSlugRegistrationsConfirmInfoGet = openApiRoute(
  registrationConfirmInfoGetRouteSchema,
  handleConfirmInfo,
  (c: any) => c.set("sensitive", true),
);
