import { Hono } from "hono";
import { fromHono } from "chanfana";
import registrationId_Router from "./[registrationId]/router";
import { onRequestGet as exportHandler } from "./export";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

// Static route must be declared before the dynamic /:registrationId route
app.get("/export", exportHandler);

openapi.route("/:registrationId", registrationId_Router);

export default openapi;
