/**
 * Public current-headshot image endpoint.
 *
 * GET /api/v1/users/:userId/headshots/:file
 *
 * Serves headshot images from their upload or migration R2 bucket. No
 * authentication is required, but only the user's current D1-referenced key
 * is served. Replaced and removed keys are revoked immediately even if their
 * asynchronous R2 cleanup needs a retry.
 *
 * The storage key is read from the row, not rebuilt from the URL. Rebuilding
 * it as `headshots/:userId/:file` assumed a shape only the upload path writes,
 * so a portrait carried over by the member migration — stored under
 * `member-photos/<orgSlug>/<file>` — was unreachable here and showed nowhere
 * in the portal (issue #28).
 */
import { dispatchRequestMethod } from "../../../../../_lib/http";
import { currentUserHeadshotResponse } from "../../../../../_lib/services/user-headshot";

export async function onRequestGet(c: any): Promise<Response> {
  const userId = c.req.param("userId");
  const file = c.req.param("file");

  return currentUserHeadshotResponse(c.env.DB, c.env, userId, file);
}

export async function onRequest(c: any): Promise<Response> {
  return dispatchRequestMethod(c, { GET: onRequestGet });
}
