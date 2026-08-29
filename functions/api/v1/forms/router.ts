import { Hono, type Next } from "hono";
import { fromHono } from "chanfana";
import { FormsCreatePost, FormsListGet } from "./index";
import formKey_Router from "./[formKey]/router";
import type { RequestDbContext } from "../../../_lib/db/context";
import { requestDb } from "../../../_lib/db/context";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { rejectLegacyMembershipApplicationFormRoute } from "../../../_lib/services/membership/application-form";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);
app.use("*", async (c, next: Next) => {
  await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await next();
});
app.use("/:formKey", async (c, next: Next) => {
  rejectLegacyMembershipApplicationFormRoute(c.req.param("formKey"));
  await next();
});
app.use("/:formKey/*", async (c, next: Next) => {
  rejectLegacyMembershipApplicationFormRoute(c.req.param("formKey"));
  await next();
});
openapi.get("/", FormsListGet);
openapi.post("/", FormsCreatePost);
openapi.route("/:formKey", formKey_Router);
export default openapi;
