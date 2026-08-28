import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersGet } from "./index";
import { MembersIdGet } from "./[id]";
import { MembersIdLogoGet } from "./[id]/logo";
import { MembersWallGet } from "./wall";
import applications_Router from "./applications/router";
import join_Router from "./join/router";
import { MemberCapacityDelete, MemberCapacityGrant, MemberCapacitiesList, MemberCapacityUpdate } from "./capacities";
import { MemberProvision } from "./index";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/applications", applications_Router);
openapi.route("/join", join_Router);
openapi.get("/", MembersGet);
openapi.post("/", MemberProvision);
openapi.get("/wall", MembersWallGet);
openapi.get("/capacities", MemberCapacitiesList);
openapi.post("/capacities", MemberCapacityGrant);
openapi.patch("/capacities/:id", MemberCapacityUpdate);
openapi.delete("/capacities/:id", MemberCapacityDelete);
openapi.get("/:id/logo", MembersIdLogoGet);
openapi.get("/:id", MembersIdGet);

export default openapi;
