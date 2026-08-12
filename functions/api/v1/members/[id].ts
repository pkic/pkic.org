/**
 * GET /api/v1/members/:id
 *
 * Public member profile. `id` is an organization id for
 * org-tied members, or the individual member's own id for org-less
 * categories (H5/H6/H7) — matching the `id` field returned by GET /members.
 */
import { OpenAPIRoute } from "chanfana";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { getPublicMemberById } from "../../../_lib/services/members-directory";
import { memberDetailRouteSchema } from "../../../../assets/shared/schemas/members-directory";

const PUBLIC_CACHE_CONTROL = "public, max-age=300, s-maxage=900, stale-while-revalidate=60";

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const member = await getPublicMemberById(c.env.DB, id);
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
  }
  const response = json(member);
  response.headers.set("cache-control", PUBLIC_CACHE_CONTROL);
  return response;
}

export class MembersIdGet extends OpenAPIRoute {
  schema = memberDetailRouteSchema;

  async handle(c: any) {
    return onRequestGet(c);
  }
}
