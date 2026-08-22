import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { onRequestGet as RegistrationsManageTokenGet_l } from "./[token]";
import { onRequestPatch as RegistrationsManageTokenPatch_l } from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  c.set("sensitive", true);
  await next();
});

app.get("/:token", RegistrationsManageTokenGet_l);
app.patch("/:token", RegistrationsManageTokenPatch_l);
openapi.route("/:token", token_Router);

export default openapi;
