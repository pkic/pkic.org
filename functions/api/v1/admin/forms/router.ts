import { Hono } from "hono";
import { fromHono } from "chanfana";
import formKey_Router from "./[formKey]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.route("/:formKey", formKey_Router);

export default app;
