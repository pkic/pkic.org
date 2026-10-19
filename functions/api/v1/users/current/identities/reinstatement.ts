/**
 * The signed-in person reinstates one of their own ended identities by
 * proving the identity's address again:
 *   POST /api/v1/users/current/identities/:identityId/reinstatement   (send a link)
 *   POST /api/v1/users/current/identities/reinstatement/preview       (review a link)
 *   POST /api/v1/users/current/identities/reinstatement/confirmation  (confirm a link)
 */
import {
  identityMutationResponseSchema,
  identityReinstatementPreviewResponseSchema,
  identityReinstatementRequestResponseSchema,
} from "../../../../../../assets/shared/schemas/identity";
import {
  currentUserIdentityReinstatementConfirmRouteSchema,
  currentUserIdentityReinstatementPreviewRouteSchema,
  currentUserIdentityReinstatementRequestRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts-identities";
import { prepareMagicLinkRequestHttp } from "../../../../../_lib/auth/http-flow";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { processOutboxByIdBackground } from "../../../../../_lib/email/outbox";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requireInternalSecret } from "../../../../../_lib/request";
import {
  confirmOwnIdentityReinstatement,
  previewOwnIdentityReinstatement,
  requestOwnIdentityReinstatement,
} from "../../../../../_lib/services/identities";

/** Reinstatement mail is limited per person and per network through the shared magic-link controls. */
const REINSTATEMENT_MAIL_RATE_LIMIT_NAMESPACE = "identity-reinstatement";

export const CurrentUserIdentityReinstatementPost = openApiRoute(
  currentUserIdentityReinstatementRequestRouteSchema,
  async (c: AdminContext, data) => {
    const actor = await requireIdentityFromRequest(requestDb(c), c.req.raw, c.env);
    const http = await prepareMagicLinkRequestHttp(c, actor.userId, REINSTATEMENT_MAIL_RATE_LIMIT_NAMESPACE);
    const sent = await requestOwnIdentityReinstatement(http.db, {
      identityId: data.params.identityId,
      userId: actor.userId,
      sessionId: actor.sessionId,
      signingSecret: http.secret,
      appBaseUrl: http.appBaseUrl,
    });
    c.executionCtx.waitUntil(processOutboxByIdBackground(http.db, c.env, sent.outboxId));
    return jsonPrivate(
      identityReinstatementRequestResponseSchema.parse({ success: true, recipientEmail: sent.recipientEmail }),
      202,
    );
  },
);

export const CurrentUserIdentityReinstatementPreviewPost = openApiRoute(
  currentUserIdentityReinstatementPreviewRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const preview = await previewOwnIdentityReinstatement(db, {
      token: data.body.token,
      signingSecret: requireInternalSecret(c.env),
      userId: actor.userId,
    });
    return jsonPrivate(identityReinstatementPreviewResponseSchema.parse({ success: true, ...preview }));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);

export const CurrentUserIdentityReinstatementConfirmationPost = openApiRoute(
  currentUserIdentityReinstatementConfirmRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const actor = await requireIdentityFromRequest(db, c.req.raw, c.env);
    const reinstated = await confirmOwnIdentityReinstatement(db, {
      token: data.body.token,
      signingSecret: requireInternalSecret(c.env),
      userId: actor.userId,
      sessionId: actor.sessionId,
    });
    return jsonPrivate(identityMutationResponseSchema.parse({ success: true, ...reinstated }));
  },
  (c: AdminContext) => c.set?.("sensitive", true),
);
