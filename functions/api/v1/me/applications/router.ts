import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MeApplicationsGet } from "./index";
import applicationId_Router from "./[id]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MeApplicationsGet);
openapi.route("/:id", applicationId_Router);

export default openapi;
