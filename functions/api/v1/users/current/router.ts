import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { CurrentUserGet, CurrentUserPatch } from "./index";
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
import { CurrentUserRegistrationsGet } from "./registrations/index";
import { CurrentUserDonationsGet } from "./donations/index";
import { CurrentUserProposalsGet } from "./proposals/index";
import identitiesRouter from "./identities/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", CurrentUserGet);
openapi.patch("/", CurrentUserPatch);
openapi.put("/headshot", CurrentUserHeadshotPut);
openapi.get("/notifications/preferences", CurrentUserNotificationPreferencesGet);
openapi.patch("/notifications/preferences", CurrentUserNotificationPreferencesPatch);
openapi.get("/votes", CurrentUserVotesGet);
openapi.get("/meetings", CurrentUserMeetingsGet);
openapi.get("/forms", CurrentUserFormsGet);
openapi.get("/registrations", CurrentUserRegistrationsGet);
openapi.get("/donations", CurrentUserDonationsGet);
openapi.get("/proposals", CurrentUserProposalsGet);
openapi.route("/groups", groupsRouter);
openapi.route("/applications", applicationsRouter);
openapi.route("/organizations", organizationsRouter);
openapi.route("/identities", identitiesRouter);

export default openapi;
