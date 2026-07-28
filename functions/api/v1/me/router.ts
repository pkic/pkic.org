import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MeGet, MePatch } from "./index";
import { MeOrganizationVisibilityPatch } from "./organization-visibility";
import { MeOrganizationGet, MeOrganizationPatch } from "./organization/index";
import { MeOrganizationMembersPost } from "./organization/members";
import { MeOrganizationLogoPost } from "./organization/logo";
import { MeOrganizationSponsorshipGet } from "./organization/sponsorship";
import { MeOrganizationReviewsGet } from "./organization/reviews/index";
import { MeOrganizationReviewDelete } from "./organization/reviews/[id]";
import { MeSecondaryContactPatch } from "./organization/secondary-contact";
import { MeHeadshotPost } from "./headshot";
import { MeVotesGet } from "./votes";
import applications_Router from "./applications/router";
import calendar_Router from "./calendar/router";
import workingGroups_Router from "./working-groups/router";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MeGet);
openapi.patch("/", MePatch);
openapi.patch("/organization-visibility", MeOrganizationVisibilityPatch);
openapi.get("/organization", MeOrganizationGet);
openapi.patch("/organization", MeOrganizationPatch);
openapi.get("/organization/sponsorship", MeOrganizationSponsorshipGet);
openapi.post("/organization/members", MeOrganizationMembersPost);
openapi.post("/organization/logo", MeOrganizationLogoPost);
openapi.get("/organization/reviews", MeOrganizationReviewsGet);
openapi.delete("/organization/reviews/:id", MeOrganizationReviewDelete);
openapi.patch("/organization/secondary-contact", MeSecondaryContactPatch);
openapi.post("/headshot", MeHeadshotPost);
openapi.get("/votes", MeVotesGet);
openapi.route("/applications", applications_Router);
openapi.route("/calendar", calendar_Router);
openapi.route("/working-groups", workingGroups_Router);

export default openapi;
