import { Hono } from "hono";
import { fromHono } from "chanfana";
import registrationId_Router from "./[registrationId]/router";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.route("/:registrationId", registrationId_Router);

export default app;
