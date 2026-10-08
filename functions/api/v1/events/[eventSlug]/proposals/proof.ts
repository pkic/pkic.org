import { updateEventProposalOwnIdentity } from "../../../../../_lib/services/event-proposal-proof-identity";
import { updateEventProposalProofPerson } from "../../../../../_lib/services/event-proposal-proof-profile";
import {
  eventProposalProofIdentityPatchRouteSchema,
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofPersonPatchRouteSchema,
  eventProposalProofPersonPatchResponseSchema,
  eventProposalProofStartRouteSchema,
  eventProposalProofVerifyRouteSchema,
  eventProposalProofIdentitiesRouteSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifyResponseSchema,
} from "../../../../../../assets/shared/schemas/event-proposal-proof";
import { identitiesListResponseSchema } from "../../../../../../assets/shared/schemas/identity";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { json, jsonPrivate } from "../../../../../_lib/http";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { requireInternalSecret } from "../../../../../_lib/request";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { getUserSessionToken } from "../../../../../_lib/auth/user-session-token";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import {
  startEventProposalProof,
  verifyEventProposalProof,
  listEventProposalProofIdentities,
} from "../../../../../_lib/services/event-proposal-proof";

export const EventProposalProofPost = openApiRoute(eventProposalProofStartRouteSchema, async (c, data) => {
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  const result = await startEventProposalProof(c.env.DB, {
    event,
    body: data.body,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    ttlSeconds: 30 * 60,
    signingSecret: requireInternalSecret(c.env),
    actor: getUserSessionToken(c.req.raw) ? await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env) : undefined,
  });
  if (result.outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, result.outboxId));
  return json(eventProposalProofStartResponseSchema.parse({ status: result.status }));
});

export const EventProposalProofVerifyPost = openApiRoute(eventProposalProofVerifyRouteSchema, async (c, data) => {
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  return jsonPrivate(
    eventProposalProofVerifyResponseSchema.parse(
      await verifyEventProposalProof(c.env.DB, {
        eventId: event.id,
        token: data.body.token,
        event,
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        signingSecret: requireInternalSecret(c.env),
        actor: getUserSessionToken(c.req.raw)
          ? await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env)
          : undefined,
        speakerManagementToken: data.body.speakerManagementToken,
        speakerProposalId: data.body.speakerProposalId,
      }),
    ),
  );
});

export const EventProposalProofIdentitiesPost = openApiRoute(
  eventProposalProofIdentitiesRouteSchema,
  async (c, data) => {
    const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
    return jsonPrivate(
      identitiesListResponseSchema.parse(
        await listEventProposalProofIdentities(c.env.DB, {
          eventId: event.id,
          continuationToken: data.body.continuationToken,
          signingSecret: requireInternalSecret(c.env),
          query: data.query,
          actor: getUserSessionToken(c.req.raw)
            ? await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env)
            : undefined,
          speakerManagementToken: data.body.speakerManagementToken,
          speakerProposalId: data.body.speakerProposalId,
        }),
      ),
    );
  },
);

export const EventProposalProofPersonPatch = openApiRoute(eventProposalProofPersonPatchRouteSchema, async (c, data) => {
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  return jsonPrivate(
    eventProposalProofPersonPatchResponseSchema.parse(
      await updateEventProposalProofPerson(c.env.DB, {
        eventId: event.id,
        signingSecret: requireInternalSecret(c.env),
        body: data.body,
        actor: getUserSessionToken(c.req.raw)
          ? await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env)
          : undefined,
      }),
    ),
  );
});

export const EventProposalProofIdentityPatch = openApiRoute(
  eventProposalProofIdentityPatchRouteSchema,
  async (c, data) => {
    const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
    return jsonPrivate(
      eventProposalProofIdentityPatchResponseSchema.parse(
        await updateEventProposalOwnIdentity(c.env.DB, {
          eventId: event.id,
          identityId: data.params.identityId,
          body: data.body,
          signingSecret: requireInternalSecret(c.env),
          actor: getUserSessionToken(c.req.raw)
            ? await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env)
            : undefined,
        }),
      ),
    );
  },
);
