import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { RegistrationsManageTokenGet, RegistrationsManageTokenPatch } from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  c.set("sensitive", true);
  await next();
});

openapi.get("/:token", RegistrationsManageTokenGet);
openapi.patch("/:token", RegistrationsManageTokenPatch);
openapi.route("/:token", token_Router);

export default openapi;
