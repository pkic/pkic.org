import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MeGet, MePatch } from "./index";
import { MeOrganizationVisibilityPatch } from "./organization-visibility";
import { MeHeadshotPost } from "./headshot";
import { MeVotesGet } from "./votes";
import applications_Router from "./applications/router";
import workingGroups_Router from "./working-groups/router";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MeGet);
openapi.patch("/", MePatch);
openapi.patch("/organization-visibility", MeOrganizationVisibilityPatch);
openapi.post("/headshot", MeHeadshotPost);
openapi.get("/votes", MeVotesGet);
openapi.route("/applications", applications_Router);
openapi.route("/working-groups", workingGroups_Router);

export default openapi;
