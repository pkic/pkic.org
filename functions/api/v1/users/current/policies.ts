import { json } from "../../../../_lib/http";
import { requireOwnAccountFromRequest } from "../../../../_lib/auth/member";
import { readAcceptedAccountPolicies } from "../../../../_lib/services/account-policies";
import {
  accountPoliciesGetRouteSchema,
  accountPoliciesResponseSchema,
} from "../../../../../assets/shared/schemas/account-policies";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { openApiRoute } from "../../../../_lib/openapi/route";

export const CurrentUserPoliciesGet = openApiRoute(accountPoliciesGetRouteSchema, async (c: AdminContext) => {
  const db = requestDb(c);
  const account = await requireOwnAccountFromRequest(db, c.req.raw, c.env);
  return json(accountPoliciesResponseSchema.parse({ accepted: await readAcceptedAccountPolicies(db, account.userId) }));
});
