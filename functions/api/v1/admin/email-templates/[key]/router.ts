import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEmailTemplatesKeyActivatePost } from "./activate";
import {
  onRequestGet as AdminEmailTemplatesKeyVersionsGet_l,
  onRequestPost as AdminEmailTemplatesKeyVersionsPost_l,
} from "./versions";
import { onRequestGet as AdminEmailTemplatesKeyExistsGet_l } from "./exists";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/activate", AdminEmailTemplatesKeyActivatePost);
app.get("/versions", AdminEmailTemplatesKeyVersionsGet_l);
app.post("/versions", AdminEmailTemplatesKeyVersionsPost_l);
app.get("/exists", AdminEmailTemplatesKeyExistsGet_l);

export default openapi;
