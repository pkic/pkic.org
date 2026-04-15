import { Hono } from "hono";
import { fromHono } from "chanfana";
import registrationId_Router from "./[registrationId]/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/:registrationId", registrationId_Router);

export default app;
