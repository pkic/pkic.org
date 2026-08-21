import { dispatchPostOnly, json } from "../../../../_lib/http";
import { requireAdminFromRequest } from "../../../../_lib/auth/admin";
import { runRetentionJob } from "../../../../_lib/services/retention";

export async function onRequestPost(c: any): Promise<Response> {
  await requireAdminFromRequest(c.env.DB, c.req.raw);
  const result = await runRetentionJob(c.env.DB);
  return json({ success: true, ...result });
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchPostOnly(c, onRequestPost);
}
