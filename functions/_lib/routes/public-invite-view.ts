import { resolveAppBaseUrl } from "../config";
import type { AdminContext } from "../db/context";
import { json } from "../http";
import { requireInternalSecret } from "../request";
import { resolvePublicInviteView } from "../services/invite-public-info";

export async function loadPublicInviteView(c: AdminContext, token: string, inviteId?: string) {
  c.set?.("sensitive", true);
  const resolved = await resolvePublicInviteView(c.env.DB, requireInternalSecret(c.env), token, inviteId);
  if (resolved.status !== "valid") return json({ status: resolved.status });
  return { ...resolved, appBaseUrl: resolveAppBaseUrl(c.env, c.req.raw) };
}
