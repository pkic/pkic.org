/**
 * GET/PATCH /api/v1/me/notification-preferences Account Settings.
 */
import { json } from "../../../_lib/http";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import {
  getMyNotificationPreferences,
  updateMyNotificationPreferences,
} from "../../../_lib/services/member-self-service";
import {
  myNotificationPreferencesGetRouteSchema,
  myNotificationPreferencesUpdateRouteSchema,
} from "../../../../assets/shared/schemas/me";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { openApiRoute } from "../../../_lib/openapi/route";

export const MeNotificationPreferencesGet = openApiRoute(
  myNotificationPreferencesGetRouteSchema,
  async (c: AdminContext) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const preferences = await getMyNotificationPreferences(db, member);
    return json(preferences);
  },
);

export const MeNotificationPreferencesPatch = openApiRoute(
  myNotificationPreferencesUpdateRouteSchema,
  async (c: AdminContext, data) => {
    const db = requestDb(c);
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    const preferences = await updateMyNotificationPreferences(db, member, data.body);
    return json(preferences);
  },
);
