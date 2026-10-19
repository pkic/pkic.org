import { Hono } from "hono";
import { fromHono } from "chanfana";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { requestDb, type AdminContext, type RequestDbContext } from "../../../../../_lib/db/context";
import { requireOwnAccountFromRequest } from "../../../../../_lib/auth/member";
import { jsonNoStore } from "../../../../../_lib/http";
import { requireInternalSecret } from "../../../../../_lib/request";
import { assertSameOriginRequest } from "../../../../../_lib/request-origin";
import {
  listOwnedOauthAuthorizations,
  listOwnedOauthAuthorizationScopes,
  reviewOwnedOauthAuthorization,
} from "../../../../../_lib/services/oauth-authorizations/read-model";
import {
  reduceOauthAuthorization,
  revokeOauthAuthorization,
} from "../../../../../_lib/services/oauth-authorizations/limits";
import { readOauthCompletionResult } from "../../../../../_lib/services/oauth-authorizations/completion-result";
import {
  oauthAuthorizationsListRouteSchema,
  oauthAuthorizationGetRouteSchema,
  oauthAuthorizationScopesListRouteSchema,
  oauthAuthorizationReduceRouteSchema,
  oauthAuthorizationRevokeRouteSchema,
  oauthAuthorizationCompletionRouteSchema,
} from "../../../../../../assets/shared/schemas/oauth-authorizations";

const router = fromHono(new Hono<RequestDbContext>());
const account = (c: AdminContext) => requireOwnAccountFromRequest(requestDb(c), c.req.raw, c.env);
const mutationOrigin = (c: AdminContext) =>
  assertSameOriginRequest(c.req.raw, new URL(c.req.raw.url).origin, "oauth_authorization");
router.get(
  "/",
  openApiRoute(oauthAuthorizationsListRouteSchema, async (c: AdminContext, data) =>
    jsonNoStore(await listOwnedOauthAuthorizations(requestDb(c), await account(c), data.query)),
  ),
);
router.get(
  "/:id",
  openApiRoute(oauthAuthorizationGetRouteSchema, async (c: AdminContext, data) =>
    jsonNoStore(await reviewOwnedOauthAuthorization(requestDb(c), await account(c), data.params.id)),
  ),
);
router.get(
  "/:id/scopes",
  openApiRoute(oauthAuthorizationScopesListRouteSchema, async (c: AdminContext, data) =>
    jsonNoStore(await listOwnedOauthAuthorizationScopes(requestDb(c), await account(c), data.params.id, data.query)),
  ),
);
router.get(
  "/:id/completion",
  openApiRoute(oauthAuthorizationCompletionRouteSchema, async (c: AdminContext, data) =>
    jsonNoStore(
      await readOauthCompletionResult(requestDb(c), await account(c), data.params.id, requireInternalSecret(c.env)),
    ),
  ),
);
router.patch(
  "/:id",
  openApiRoute(
    oauthAuthorizationReduceRouteSchema,
    async (c: AdminContext, data) =>
      jsonNoStore(await reduceOauthAuthorization(requestDb(c), await account(c), data.params.id, data.body)),
    mutationOrigin,
  ),
);
router.post(
  "/:id/revoke",
  openApiRoute(
    oauthAuthorizationRevokeRouteSchema,
    async (c: AdminContext, data) =>
      jsonNoStore(await revokeOauthAuthorization(requestDb(c), await account(c), data.params.id, data.body.revision)),
    mutationOrigin,
  ),
);
export default router;
