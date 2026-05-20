import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as AdminEmailTemplatesPreviewPost_l } from "./preview";
import key_Router from "./[key]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.post("/preview", AdminEmailTemplatesPreviewPost_l);
app.route("/:key", key_Router);

export default app;
