import { requireAdminFromRequest } from "../../../_lib/auth/admin";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { dispatchRequestMethod, json } from "../../../_lib/http";
import { getAdminPlatformStats } from "../../../_lib/services/admin-platform-stats";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  await requireAdminFromRequest(db, c.req.raw, c.env);
  return json(await getAdminPlatformStats(db));
}

export async function onRequest(c: AdminContext): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
