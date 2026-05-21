import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as AdminFormsGet_l, onRequestPost as AdminFormsPost_l } from "./index";
import formKey_Router from "./[formKey]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.get("/", AdminFormsGet_l);
app.post("/", AdminFormsPost_l);
app.route("/:formKey", formKey_Router);

export default app;
