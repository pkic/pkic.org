import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEmailTemplatesKeyActivatePost } from "./activate";
import { EmailTemplateVersionCreate, EmailTemplateVersionsList } from "./versions";
import { onRequestGet as AdminEmailTemplatesKeyExistsGet_l } from "./exists";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/activate", AdminEmailTemplatesKeyActivatePost);
openapi.get("/versions", EmailTemplateVersionsList);
openapi.post("/versions", EmailTemplateVersionCreate);
app.get("/exists", AdminEmailTemplatesKeyExistsGet_l);

export default openapi;
