import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminEmailTemplatePreviewPost } from "./preview";
import key_Router from "./[key]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/preview", AdminEmailTemplatePreviewPost);
openapi.route("/:key", key_Router);

export default openapi;
