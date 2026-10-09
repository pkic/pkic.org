/**
 * Public current-headshot image endpoint.
 *
 * GET /api/v1/users/:userId/headshots/:file[?width=96|192|384]
 *
 * Serves headshot images from their upload or migration R2 bucket. No
 * authentication is required, but only the user's current D1-referenced key
 * is served. Replaced and removed keys are revoked immediately even if their
 * asynchronous R2 cleanup needs a retry. `width` asks for a bounded square
 * rendition of the same current file for small avatars.
 *
 * The storage key is read from the row, not rebuilt from the URL. Rebuilding
 * it as `headshots/:userId/:file` assumed a shape only the upload path writes,
 * so a portrait carried over by the member migration — stored under
 * `member-photos/<orgSlug>/<file>` — was unreachable here and showed nowhere
 * in the portal (issue #28).
 */
import type { Context } from "hono";
import type { ValidatedData } from "chanfana";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { currentUserHeadshotResponse } from "../../../../../_lib/services/user-headshot";
import { userHeadshotFileGetRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-headshots";

async function onGet(
  c: Context<RequestDbContext>,
  data: ValidatedData<typeof userHeadshotFileGetRouteSchema>,
): Promise<Response> {
  const { userId, file } = data.params;
  const width = data.query.width;
  return currentUserHeadshotResponse(
    c.env.DB,
    c.env,
    userId,
    file,
    width ? { width, origin: new URL(c.req.url).origin } : undefined,
  );
}

export const UserHeadshotFileGet = openApiRoute(userHeadshotFileGetRouteSchema, onGet);
