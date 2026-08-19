import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEmailTemplatesKeyActivatePost } from "./activate";
import { EmailTemplateVersionsList, onRequestPost as AdminEmailTemplatesKeyVersionsPost_l } from "./versions";
import { onRequestGet as AdminEmailTemplatesKeyExistsGet_l } from "./exists";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/activate", AdminEmailTemplatesKeyActivatePost);
openapi.get("/versions", EmailTemplateVersionsList);
app.post("/versions", AdminEmailTemplatesKeyVersionsPost_l);
app.get("/exists", AdminEmailTemplatesKeyExistsGet_l);

export default openapi;
