import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminFormsFormKeyGet } from "./index";
import { AdminFormsFormKeyPatch } from "./index";
import { AdminFormsFormKeyDelete } from "./index";
import { onRequestGet as AdminFormsFormKeySubmissionsGet_l } from "./submissions";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", AdminFormsFormKeyGet);
openapi.patch("/", AdminFormsFormKeyPatch);
openapi.delete("/", AdminFormsFormKeyDelete);
app.get("/submissions", AdminFormsFormKeySubmissionsGet_l);

export default openapi;
