import { guardUserSessionDatabase } from "../../../../../_lib/auth/member";
/**
 * The signed-in person's own email addresses:
 *   GET    /api/v1/users/current/emails
 *   POST   /api/v1/users/current/emails
 *   PATCH  /api/v1/users/current/emails/:emailId              (make primary)
 *   DELETE /api/v1/users/current/emails/:emailId
 *   POST   /api/v1/users/current/emails/:emailId/verification (send a new link)
 */
import {
  ownEmailAddressAddRouteSchema,
  ownEmailAddressRemoveRouteSchema,
  ownEmailAddressResponseSchema,
  ownEmailVerificationRequestedResponseSchema,
  ownEmailVerificationSentResponseSchema,
  ownEmailAddressUpdateRouteSchema,
  ownEmailAddressVerificationRequestRouteSchema,
  ownEmailAddressesListResponseSchema,
  ownEmailAddressesListRouteSchema,
} from "../../../../../../assets/shared/schemas/own-email-addresses";
import { successResponseSchema } from "../../../../../../assets/shared/schemas/api-common";
import { prepareMagicLinkRequestHttp } from "../../../../../_lib/auth/http-flow";
import { requireIdentityFromRequest } from "../../../../../_lib/auth/user-session";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { deliverOutboxMessageNow } from "../../../../../_lib/email/outbox";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  addOwnEmailAddress,
  listOwnEmailAddresses,
  updateOwnEmailAddress,
  removeOwnEmailAddress,
} from "../../../../../_lib/services/own-email-addresses";
import { requestOwnEmailVerification } from "../../../../../_lib/services/own-email-verification";

/**
 * Verification mail is limited per person and per network through the
 * shared magic-link controls: the signed-in person is who asks for it.
 */
import { verifyUserSessionRequest } from "../../../../../_lib/auth/user-session-request";
import { userSessionRequestAuthorizationEvidence } from "../../../../../_lib/auth/user-session-evidence";

const VERIFICATION_MAIL_RATE_LIMIT_NAMESPACE = "user-email-verification";

async function currentUser(c: AdminContext) {
  const db = requestDb(c);
  return { db, actor: await requireIdentityFromRequest(db, c.req.raw, c.env) };
}

export const OwnEmailAddressesGet = openApiRoute(ownEmailAddressesListRouteSchema, async (c: AdminContext, data) => {
  const { db, actor } = await currentUser(c);
  return jsonPrivate(
    ownEmailAddressesListResponseSchema.parse(await listOwnEmailAddresses(db, actor.userId, data.query)),
  );
});

export const OwnEmailAddressPost = openApiRoute(ownEmailAddressAddRouteSchema, async (c: AdminContext, data) => {
  const claims = await verifyUserSessionRequest(c.req.raw, c.env);
  const http = await prepareMagicLinkRequestHttp(c, claims.sub, VERIFICATION_MAIL_RATE_LIMIT_NAMESPACE);
  const added = await addOwnEmailAddress(http.db, {
    userId: claims.sub,
    authorizationEvidence: userSessionRequestAuthorizationEvidence(claims),
    ...data.body,
    signingSecret: http.secret,
    appBaseUrl: http.appBaseUrl,
  });
  const delivery = await deliverOutboxMessageNow(http.db, c.env, added.outboxId);
  return jsonPrivate(ownEmailVerificationRequestedResponseSchema.parse({ ...added, delivery }), 202);
});

export const OwnEmailAddressVerificationPost = openApiRoute(
  ownEmailAddressVerificationRequestRouteSchema,
  async (c: AdminContext, data) => {
    const claims = await verifyUserSessionRequest(c.req.raw, c.env);
    const http = await prepareMagicLinkRequestHttp(c, claims.sub, VERIFICATION_MAIL_RATE_LIMIT_NAMESPACE);
    const sent = await requestOwnEmailVerification(http.db, {
      userId: claims.sub,
      authorizationEvidence: userSessionRequestAuthorizationEvidence(claims),
      emailId: data.params.emailId,
      signingSecret: http.secret,
      appBaseUrl: http.appBaseUrl,
    });
    const delivery = await deliverOutboxMessageNow(http.db, c.env, sent.outboxId);
    return jsonPrivate(ownEmailVerificationSentResponseSchema.parse({ delivery }), 202);
  },
);

export const OwnEmailAddressPatch = openApiRoute(ownEmailAddressUpdateRouteSchema, async (c: AdminContext, data) => {
  const { db, actor } = await currentUser(c);
  const email = await updateOwnEmailAddress(guardUserSessionDatabase(db, actor), {
    userId: actor.userId,
    emailId: data.params.emailId,
    update: data.body,
  });
  return jsonPrivate(ownEmailAddressResponseSchema.parse({ email }));
});

export const OwnEmailAddressDelete = openApiRoute(ownEmailAddressRemoveRouteSchema, async (c: AdminContext, data) => {
  const { db, actor } = await currentUser(c);
  await removeOwnEmailAddress(db, { userId: actor.userId, emailId: data.params.emailId });
  return jsonPrivate(successResponseSchema.parse({ success: true }));
});
