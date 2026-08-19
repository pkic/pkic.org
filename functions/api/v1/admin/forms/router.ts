import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminFormsList, onRequestPost as AdminFormsPost_l } from "./index";
import formKey_Router from "./[formKey]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", AdminFormsList);
app.post("/", AdminFormsPost_l);
openapi.route("/:formKey", formKey_Router);

export default openapi;
