import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { CurrentUserGet, CurrentUserPatch } from "./index";
import { CurrentUserActiveMembershipPut } from "./memberships/active";
import { CurrentUserHeadshotPut } from "./headshot";
import {
  CurrentUserNotificationPreferencesGet,
  CurrentUserNotificationPreferencesPatch,
} from "./notifications/preferences";
import groupsRouter from "./groups/router";
import applicationsRouter from "./applications/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", CurrentUserGet);
openapi.patch("/", CurrentUserPatch);
openapi.put("/memberships/active", CurrentUserActiveMembershipPut);
openapi.put("/headshot", CurrentUserHeadshotPut);
openapi.get("/notifications/preferences", CurrentUserNotificationPreferencesGet);
openapi.patch("/notifications/preferences", CurrentUserNotificationPreferencesPatch);
openapi.route("/groups", groupsRouter);
openapi.route("/applications", applicationsRouter);

export default openapi;
