import {
  eventTicketGuidancePutRouteSchema,
  eventTicketOfferRouteSchema,
  eventTicketPricesPutRouteSchema,
  eventTicketQuoteRouteSchema,
  eventTicketSettingsPutRouteSchema,
  eventTicketSponsorCodesPostRouteSchema,
  eventTicketSponsorPassesPutRouteSchema,
  eventTicketTypeCreateRouteSchema,
  eventTicketTypeUpdateRouteSchema,
  eventTicketsGetRouteSchema,
} from "../../../../../assets/shared/schemas/event-tickets";
import {
  registrationTicketCheckoutRouteSchema,
  registrationTicketGetRouteSchema,
  registrationTicketRefundRouteSchema,
  registrationTicketReviewRouteSchema,
  registrationTicketSyncRouteSchema,
} from "../../../../../assets/shared/schemas/registration-tickets";
import {
  eventTicketCodeCreateRouteSchema,
  eventTicketCodesGetRouteSchema,
  eventTicketCodeUpdateRouteSchema,
  eventTicketSponsorsGetRouteSchema,
} from "../../../../../assets/shared/schemas/event-ticket-codes";
import { hasPermission } from "../../../../_lib/auth/permissions";
import { getUserSessionToken, requireIdentityFromRequest } from "../../../../_lib/auth/user-session";
import { resolveAppBaseUrl } from "../../../../_lib/config";
import { processSelectedOutboxBackground } from "../../../../_lib/email/outbox";
import { markResponseSensitive, requestDb, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import { json } from "../../../../_lib/http";
import { openApiRoute } from "../../../../_lib/openapi/route";
import {
  createEventTicketCode,
  readEventTicketsConfiguration,
  replaceEventTicketPrices,
  saveEventTicketType,
  updateEventTicketCode,
  updateEventTicketGuidance,
  updateEventTicketSettings,
} from "../../../../_lib/services/event-tickets/configuration";
import { reviewDisputedTicket } from "../../../../_lib/services/event-tickets/dispute";
import {
  guestTicketOffer,
  quoteEventTicket,
  readEventTicketOffer,
} from "../../../../_lib/services/event-tickets/offer";
import { openTicketCheckout } from "../../../../_lib/services/event-tickets/payment";
import { issueSponsorPassCodes, saveSponsorPasses } from "../../../../_lib/services/event-tickets/sponsor-passes";
import { listEventTicketCodes } from "../../../../_lib/services/event-tickets/code-list";
import { listEventTicketSponsors } from "../../../../_lib/services/event-tickets/event-sponsors";
import {
  listIssuedTickets,
  updateIssuedTicketsFromProvider,
} from "../../../../_lib/services/event-tickets/issued-list";
import {
  issuedTicketsGetRouteSchema,
  issuedTicketsUpdateRouteSchema,
} from "../../../../../assets/shared/schemas/event-issued-tickets";
import { requestTicketRefund } from "../../../../_lib/services/event-tickets/refunds";
import { syncRegistrationTicketWithProvider } from "../../../../_lib/services/event-tickets/provider-sync";
import { readTicketPaymentDetails } from "../../../../_lib/services/event-tickets/payment-details";
import {
  readRegistrationOwner,
  readRegistrationTicket,
} from "../../../../_lib/services/event-tickets/registration-ticket";
import { readEventAdminContext } from "../../../../_lib/services/events/authorized-context";
import { readAudienceEventBySlug } from "../../../../_lib/services/events/audience-event";
import { getEventBySlug } from "../../../../_lib/services/events";
import { requireEventPermission } from "./authorization";

const EventTicketsGet = openApiRoute(eventTicketsGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
  return json(await readEventTicketsConfiguration(db, event));
});

const EventTicketTypePost = openApiRoute(eventTicketTypeCreateRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json({ success: true, ...(await saveEventTicketType(db, actor, event, null, data.body)) });
});

const EventTicketTypePut = openApiRoute(eventTicketTypeUpdateRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json({ success: true, ...(await saveEventTicketType(db, actor, event, data.params.ticketTypeId, data.body)) });
});

const EventTicketPricesPut = openApiRoute(eventTicketPricesPutRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json({ success: true, ...(await replaceEventTicketPrices(db, actor, event, data.body)) });
});

const EventTicketSettingsPut = openApiRoute(eventTicketSettingsPutRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json({ success: true, ...(await updateEventTicketSettings(db, actor, event, data.body)) });
});

const EventTicketGuidancePut = openApiRoute(eventTicketGuidancePutRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json({ success: true, ...(await updateEventTicketGuidance(db, actor, event, data.body)) });
});

const EventTicketCodesGet = openApiRoute(eventTicketCodesGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json(await listEventTicketCodes(db, event.id, data.query));
});

const EventTicketSponsorsGet = openApiRoute(eventTicketSponsorsGetRouteSchema, async (c: AdminContext, data) => {
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json(await listEventTicketSponsors(db, event.id, data.query));
});

const EventTicketCodePost = openApiRoute(eventTicketCodeCreateRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  return json({ success: true, code: await createEventTicketCode(db, actor, event, data.body) });
});

const EventTicketCodePatch = openApiRoute(eventTicketCodeUpdateRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  await updateEventTicketCode(db, actor, event, data.params.codeId, data.body);
  return json({ success: true });
});

const EventTicketOfferGet = openApiRoute(eventTicketOfferRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const { event, identity } = await readAudienceEventBySlug(db, c.req.raw, c.env, data.params.eventSlug);
  // A guest has no ticket to be shown yet: theirs is issued with the registration, from the same rules.
  if (!identity) {
    if (getUserSessionToken(c.req.raw)) throw new AppError(401, "AUTH_REQUIRED", "A human session is required");
    return json(guestTicketOffer(event));
  }
  return json(await readEventTicketOffer(db, c.env, event, identity, data.query.identityId));
});

const EventTicketQuotePost = openApiRoute(eventTicketQuoteRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  if (!getUserSessionToken(c.req.raw)) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  const db = requestDb(c);
  const { event, identity } = await readAudienceEventBySlug(db, c.req.raw, c.env, data.params.eventSlug);
  if (!identity) throw new AppError(401, "AUTH_REQUIRED", "Missing user session token");
  return json(await quoteEventTicket(db, c.env, event, identity, data.body));
});

/** The registrant reads their own ticket; an organizer of the event reads anyone's. */
const RegistrationTicketGet = openApiRoute(registrationTicketGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  const owner = await readRegistrationOwner(db, { eventId: event.id, registrationId: data.params.registrationId });
  if (!owner) throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  if (owner !== identity.userId) {
    const { actor } = await readEventAdminContext(db, c.req.raw, c.env, data.params.eventSlug);
    if (!hasPermission(actor, "events:read", { type: "event", id: event.id }))
      throw new AppError(404, "REGISTRATION_NOT_FOUND", "Registration not found");
  }
  return json({
    ticket: await readRegistrationTicket(db, { eventId: event.id, registrationId: data.params.registrationId }),
  });
});

const RegistrationTicketCheckoutPost = openApiRoute(
  registrationTicketCheckoutRouteSchema,
  async (c: AdminContext, data) => {
    markResponseSensitive(c);
    const db = requestDb(c);
    const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const event = await getEventBySlug(db, data.params.eventSlug);
    return json(
      await openTicketCheckout(db, c.env, resolveAppBaseUrl(c.env, c.req.raw), {
        eventId: event.id,
        registrationId: data.params.registrationId,
        userId: identity.userId,
      }),
    );
  },
);

const RegistrationTicketRefundPost = openApiRoute(
  registrationTicketRefundRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    await requestTicketRefund(db, actor, {
      eventId: event.id,
      registrationId: data.params.registrationId,
      reason: data.body.reason,
    });
    return json({ success: true });
  },
);

/** An organizer brings the whole ticket in line; the registrant asks only whether their own payment arrived. */
const RegistrationTicketSyncPost = openApiRoute(registrationTicketSyncRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const db = requestDb(c);
  const identity = await requireIdentityFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, data.params.eventSlug);
  const input = { eventId: event.id, registrationId: data.params.registrationId };
  const own = (await readRegistrationOwner(db, input)) === identity.userId;
  const actor = own
    ? { id: identity.userId }
    : (await requireEventPermission(c, data.params.eventSlug, "events:write")).actor;
  const { outboxIds, changed } = await syncRegistrationTicketWithProvider(db, c.env, actor, {
    ...input,
    paymentOnly: own,
  });
  // A confirmation that the payment released goes out with this response.
  if (outboxIds.length > 0) c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, outboxIds));
  // The registrant is answered first; how they paid and the receipt are read behind the response.
  if (own && changed)
    c.executionCtx.waitUntil(readTicketPaymentDetails(c.env.DB, c.env, { eventId: event.id }).catch(() => undefined));
  return json({ success: true, changed });
});

const RegistrationTicketReviewPost = openApiRoute(
  registrationTicketReviewRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    await reviewDisputedTicket(
      db,
      actor,
      event,
      data.params.registrationId,
      data.body.decision,
      resolveAppBaseUrl(c.env, c.req.raw),
    );
    return json({ success: true });
  },
);

const EventTicketSponsorPassesPut = openApiRoute(
  eventTicketSponsorPassesPutRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    return json({ success: true, ...(await saveSponsorPasses(db, actor, event, data.body)) });
  },
);

const EventTicketSponsorCodesPost = openApiRoute(
  eventTicketSponsorCodesPostRouteSchema,
  async (c: AdminContext, data) => {
    const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
    return json({ success: true, ...(await issueSponsorPassCodes(db, actor, event)) });
  },
);

const IssuedTicketsGet = openApiRoute(issuedTicketsGetRouteSchema, async (c: AdminContext, data) => {
  markResponseSensitive(c);
  const { db, event } = await requireEventPermission(c, data.params.eventSlug, "events:read");
  return json(await listIssuedTickets(db, event, data.query));
});

const IssuedTicketsUpdatePost = openApiRoute(issuedTicketsUpdateRouteSchema, async (c: AdminContext, data) => {
  const { actor, db, event } = await requireEventPermission(c, data.params.eventSlug, "events:write");
  const { outboxIds, ...updated } = await updateIssuedTicketsFromProvider(db, c.env, actor, {
    eventId: event.id,
    after: data.body.after,
  });
  // Confirmations that settled payments released go out with this response.
  if (outboxIds.length > 0) c.executionCtx.waitUntil(processSelectedOutboxBackground(c.env.DB, c.env, outboxIds));
  return json(updated);
});

type TicketRouter = Pick<typeof import("./router").openapi, "get" | "post" | "put" | "patch">;

/** Tickets are one resource of the event; a registration's ticket is nested under the registration. */
export function registerTicketRoutes(openapi: TicketRouter): void {
  openapi.get("/tickets", EventTicketsGet);
  openapi.get("/tickets/offer", EventTicketOfferGet);
  openapi.post("/tickets/quote", EventTicketQuotePost);
  openapi.put("/tickets/prices", EventTicketPricesPut);
  openapi.put("/tickets/settings", EventTicketSettingsPut);
  openapi.put("/tickets/guidance", EventTicketGuidancePut);
  openapi.post("/tickets/types", EventTicketTypePost);
  openapi.put("/tickets/types/:ticketTypeId", EventTicketTypePut);
  openapi.get("/tickets/issued", IssuedTicketsGet);
  openapi.post("/tickets/issued/updates", IssuedTicketsUpdatePost);
  openapi.get("/tickets/codes", EventTicketCodesGet);
  openapi.post("/tickets/codes", EventTicketCodePost);
  openapi.get("/tickets/sponsors", EventTicketSponsorsGet);
  openapi.put("/tickets/sponsors/passes", EventTicketSponsorPassesPut);
  openapi.post("/tickets/sponsors/codes", EventTicketSponsorCodesPost);
  openapi.patch("/tickets/codes/:codeId", EventTicketCodePatch);
  openapi.get("/registrations/:registrationId/ticket", RegistrationTicketGet);
  openapi.post("/registrations/:registrationId/ticket/checkout", RegistrationTicketCheckoutPost);
  openapi.post("/registrations/:registrationId/ticket/refunds", RegistrationTicketRefundPost);
  openapi.post("/registrations/:registrationId/ticket/review", RegistrationTicketReviewPost);
  openapi.post("/registrations/:registrationId/ticket/sync", RegistrationTicketSyncPost);
}
