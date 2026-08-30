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
import organizationsRouter from "./organizations/router";
import { CurrentUserVotesGet } from "./votes/index";
import { CurrentUserMeetingsGet } from "./meetings/index";
import { CurrentUserFormsGet } from "./forms/index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", CurrentUserGet);
openapi.patch("/", CurrentUserPatch);
openapi.put("/memberships/active", CurrentUserActiveMembershipPut);
openapi.put("/headshot", CurrentUserHeadshotPut);
openapi.get("/notifications/preferences", CurrentUserNotificationPreferencesGet);
openapi.patch("/notifications/preferences", CurrentUserNotificationPreferencesPatch);
openapi.get("/votes", CurrentUserVotesGet);
openapi.get("/meetings", CurrentUserMeetingsGet);
openapi.get("/forms", CurrentUserFormsGet);
openapi.route("/groups", groupsRouter);
openapi.route("/applications", applicationsRouter);
openapi.route("/organizations", organizationsRouter);

export default openapi;
