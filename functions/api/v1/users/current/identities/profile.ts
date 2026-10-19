import {
  ownIdentityProfileGetRouteSchema,
  ownIdentityProfileSchema,
  ownIdentityProfileUpdateRouteSchema,
} from "../../../../../../assets/shared/schemas/own-identity-profile";
import { guardOwnAccountMutationDatabase, requireOwnAccountFromRequest } from "../../../../../_lib/auth/member";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { jsonPrivate } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import {
  readOwnIdentityProfile,
  updateOwnIdentityProfile,
} from "../../../../../_lib/services/identities/own-identity-profile";

export const CurrentUserIdentityProfileGet = openApiRoute(
  ownIdentityProfileGetRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const account = await requireOwnAccountFromRequest(db, c.req.raw, c.env);
    return jsonPrivate(
      ownIdentityProfileSchema.parse(await readOwnIdentityProfile(db, account.userId, data.params.identityId)),
    );
  },
);

/** Edits one identity the caller holds; the session keeps acting as the identity it already does. */
export const CurrentUserIdentityProfilePatch = openApiRoute(
  ownIdentityProfileUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const account = await requireOwnAccountFromRequest(db, c.req.raw, c.env);
    await updateOwnIdentityProfile(
      guardOwnAccountMutationDatabase(db, account),
      account,
      data.params.identityId,
      data.body,
    );
    return jsonPrivate(
      ownIdentityProfileSchema.parse(await readOwnIdentityProfile(db, account.userId, data.params.identityId)),
    );
  },
);
