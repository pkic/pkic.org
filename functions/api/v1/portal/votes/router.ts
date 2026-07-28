import { Hono } from "hono";
import { fromHono } from "chanfana";
import { PortalVotesGet } from "./index";
import id_Router from "./[id]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", PortalVotesGet);
openapi.route("/:id", id_Router);

export default openapi;
