/**
 * GET/PATCH /api/v1/me — my profile.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../_lib/validation";
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { getMyProfile, updateMyProfile } from "../../../_lib/services/member-self-service";
import {
  myProfileGetRouteSchema,
  myProfileUpdateRouteSchema,
  myProfileUpdateSchema,
} from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const profile = await getMyProfile(db, member);
  return json(profile);
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, myProfileUpdateSchema);
  const profile = await updateMyProfile(db, member, body);
  return json(profile);
}

export class MeGet extends OpenAPIRoute {
  schema = myProfileGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class MePatch extends OpenAPIRoute {
  schema = myProfileUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
