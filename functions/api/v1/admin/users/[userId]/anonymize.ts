/** POST /api/v1/admin/users/:userId/anonymize — irreversible account redaction and access revocation. */
import { requireAdminFromRequest } from "../../../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { dispatchPostOnly, json } from "../../../../../_lib/http";
import { anonymizeAdminUser } from "../../../../../_lib/services/admin-user-anonymize";
import { removePreviousHeadshot } from "../../../../../_lib/services/user-headshot";

export async function onRequestPost(c: AdminContext): Promise<Response> {
  const admin = await requireAdminFromRequest(requestDb(c), c.req.raw, c.env);
  const result = await anonymizeAdminUser(requestDb(c), admin, c.req.param("userId"));
  c.executionCtx.waitUntil(removePreviousHeadshot(requestDb(c), c.env, result.previousHeadshotKey));
  return json({ success: true, userId: result.userId });
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
