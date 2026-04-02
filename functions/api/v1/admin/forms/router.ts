import { Hono } from "hono";
import { fromHono } from "chanfana";
import formKey_Router from "./[formKey]/router";

const app = new Hono();
export const openapi = fromHono(app);

app.route("/:formKey", formKey_Router);

export default app;
