import { updateEventProposalOwnIdentity } from "../../../../../_lib/services/event-proposal-proof-identity";
import {
  eventProposalProofIdentityPatchRouteSchema,
  eventProposalProofIdentityPatchResponseSchema,
  eventProposalProofStartRouteSchema,
  eventProposalProofVerifyRouteSchema,
  eventProposalProofIdentitiesRouteSchema,
  eventProposalProofStartResponseSchema,
  eventProposalProofVerifyResponseSchema,
} from "../../../../../../assets/shared/schemas/event-proposal-proof";
import { identitiesListResponseSchema } from "../../../../../../assets/shared/schemas/identity";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { jsonPrivate } from "../../../../../_lib/http";
import { getEventBySlug } from "../../../../../_lib/services/events";
import { requireInternalSecret } from "../../../../../_lib/request";
import { resolveAppBaseUrl } from "../../../../../_lib/config";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import {
  startEventProposalProof,
  verifyEventProposalProof,
  listEventProposalProofIdentities,
} from "../../../../../_lib/services/event-proposal-proof";

// Every speaker step acts for a signed-in account: a speaker link or a mailbox proof never stands in for a session.

export const EventProposalProofPost = openApiRoute(eventProposalProofStartRouteSchema, async (c, data) => {
  const actor = await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  const result = await startEventProposalProof(c.env.DB, {
    event,
    body: data.body,
    appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
    ttlSeconds: 30 * 60,
    signingSecret: requireInternalSecret(c.env),
    actor,
  });
  const { outboxId, ...response } = result;
  if (outboxId) c.executionCtx.waitUntil(processOutboxByIdBackground(c.env.DB, c.env, outboxId));
  // A proved mailbox answers with its proof token, which no shared cache may keep.
  return jsonPrivate(eventProposalProofStartResponseSchema.parse(response));
});

export const EventProposalProofVerifyPost = openApiRoute(eventProposalProofVerifyRouteSchema, async (c, data) => {
  const actor = await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env);
  const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
  return jsonPrivate(
    eventProposalProofVerifyResponseSchema.parse(
      await verifyEventProposalProof(c.env.DB, {
        eventId: event.id,
        token: data.body.token,
        domain: data.body.domain,
        affiliation: data.body.affiliation,
        event,
        appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw),
        signingSecret: requireInternalSecret(c.env),
        actor,
        speakerManagementToken: data.body.speakerManagementToken,
        speakerProposalId: data.body.speakerProposalId,
      }),
    ),
  );
});

export const EventProposalProofIdentitiesPost = openApiRoute(
  eventProposalProofIdentitiesRouteSchema,
  async (c, data) => {
    const actor = await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env);
    const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
    return jsonPrivate(
      identitiesListResponseSchema.parse(
        await listEventProposalProofIdentities(c.env.DB, {
          eventId: event.id,
          continuationToken: data.body.continuationToken,
          signingSecret: requireInternalSecret(c.env),
          query: data.query,
          actor,
          speakerManagementToken: data.body.speakerManagementToken,
          speakerProposalId: data.body.speakerProposalId,
        }),
      ),
    );
  },
);

export const EventProposalProofIdentityPatch = openApiRoute(
  eventProposalProofIdentityPatchRouteSchema,
  async (c, data) => {
    const actor = await requireIdentityFromRequest(c.env.DB, c.req.raw, c.env);
    const event = await getEventBySlug(c.env.DB, data.params.eventSlug);
    return jsonPrivate(
      eventProposalProofIdentityPatchResponseSchema.parse(
        await updateEventProposalOwnIdentity(c.env.DB, {
          eventId: event.id,
          identityId: data.params.identityId,
          body: data.body,
          signingSecret: requireInternalSecret(c.env),
          actor,
        }),
      ),
    );
  },
);
