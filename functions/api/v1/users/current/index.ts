import { json } from "../../../../_lib/http";
import { guardOwnAccountMutationDatabase, requireOwnAccountFromRequest } from "../../../../_lib/auth/member";
import {
  getAccountProfile,
  getMyProfile,
  updateAccountProfile,
  updateMyProfile,
} from "../../../../_lib/services/member-self-service";
import { myProfileGetRouteSchema, myProfileUpdateRouteSchema } from "../../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const CurrentUserGet = openApiRoute(myProfileGetRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const account = await requireOwnAccountFromRequest(db, c.req.raw, c.env);
  return json(account.member ? await getMyProfile(db, account.member) : await getAccountProfile(db, account.userId));
});

export const CurrentUserPatch = openApiRoute(myProfileUpdateRouteSchema, async (c: AdminContext, data) => {
  const db = requestDb(c);
  const account = await requireOwnAccountFromRequest(db, c.req.raw, c.env);
  const guarded = guardOwnAccountMutationDatabase(db, account);
  const profile = account.member
    ? await updateMyProfile(guarded, account.member, data.body)
    : await updateAccountProfile(guarded, account, data.body);
  return json(profile);
});
