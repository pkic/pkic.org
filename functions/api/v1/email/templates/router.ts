import { Hono } from "hono";
import { fromHono } from "chanfana";
import { EmailTemplatePreviewPost } from "./preview";
import { EmailTemplateRequirementsGet } from "./requirements";
import key_Router from "./[key]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/preview", EmailTemplatePreviewPost);
// Matched before the per-key routes, which own no GET at their root.
openapi.get("/requirements", EmailTemplateRequirementsGet);
openapi.route("/:key", key_Router);

export default openapi;
