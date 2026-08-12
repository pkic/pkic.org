/**
 * GET/PATCH /api/v1/me/notification-preferences Account Settings.
 */
import { OpenAPIRoute } from "chanfana";
import { parseJsonBody } from "../../../_lib/validation";
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
} from "../../../_lib/services/member-self-service";
import {
  myNotificationPreferencesGetRouteSchema,
  myNotificationPreferencesUpdateRouteSchema,
  myNotificationPreferencesUpdateSchema,
} from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";

export async function onRequestGet(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const preferences = await getMyNotificationPreferences(db, member);
  return json(preferences);
}

export async function onRequestPatch(c: AdminContext): Promise<Response> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  const body = await parseJsonBody(c.req, myNotificationPreferencesUpdateSchema);
  const preferences = await updateMyNotificationPreferences(db, member, body);
  return json(preferences);
}

export class MeNotificationPreferencesGet extends OpenAPIRoute {
  schema = myNotificationPreferencesGetRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestGet(c);
  }
}

export class MeNotificationPreferencesPatch extends OpenAPIRoute {
  schema = myNotificationPreferencesUpdateRouteSchema;
  async handle(c: AdminContext): Promise<Response> {
    return onRequestPatch(c);
  }
}
