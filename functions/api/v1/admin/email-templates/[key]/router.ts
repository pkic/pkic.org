import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEmailTemplatesKeyActivatePost } from "./activate";
import { onRequestPost as AdminEmailTemplatesKeyVersionsPost_l } from "./versions";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/activate", AdminEmailTemplatesKeyActivatePost);
app.post("/versions", AdminEmailTemplatesKeyVersionsPost_l);

export default app;
