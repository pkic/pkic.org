import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EmailTemplatesKeyActivatePost } from "./activate";
import { EmailTemplateVersionCreate, EmailTemplateVersionsList } from "./versions";
import { EmailTemplatesKeyExistsGet } from "./exists";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/activate", EmailTemplatesKeyActivatePost);
openapi.get("/versions", EmailTemplateVersionsList);
openapi.post("/versions", EmailTemplateVersionCreate);
openapi.get("/exists", EmailTemplatesKeyExistsGet);

export default openapi;
