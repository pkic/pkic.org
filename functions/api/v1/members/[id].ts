/**
 * GET /api/v1/members/:id
 *
 * Public member profile. `id` is an organization id for
 * org-tied members, or the individual member's own id for org-less
 * categories (H5/H6/H7) — matching the `id` field returned by GET /members.
 */
import { openApiRoute } from "../../../_lib/openapi/route";
import { AppError } from "../../../_lib/errors";
import { json } from "../../../_lib/http";
import { getPublicMemberById } from "../../../_lib/services/membership/directory";
import { memberDetailRouteSchema } from "../../../../assets/shared/schemas/members-directory";

export async function onRequestGet(c: any): Promise<Response> {
  const id = c.req.param("id");
  const member = await getPublicMemberById(c.env.DB, id);
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
  }
  return json(member);
}

export const MembersIdGet = openApiRoute(memberDetailRouteSchema, onRequestGet);
