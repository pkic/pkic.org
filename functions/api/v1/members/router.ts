import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembersGet } from "./index";
import { MembersIdGet } from "./[id]";
import { MembersIdLogoGet } from "./[id]/logo";
import { MembersWallGet } from "./wall";
import applications_Router from "./applications/router";
import join_Router from "./join/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/applications", applications_Router);
openapi.route("/join", join_Router);
openapi.get("/", MembersGet);
openapi.get("/wall", MembersWallGet);
openapi.get("/:id/logo", MembersIdLogoGet);
openapi.get("/:id", MembersIdGet);

export default openapi;
