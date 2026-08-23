import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminFormsCreate, AdminFormsList } from "./index";
import formKey_Router from "./[formKey]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", AdminFormsList);
openapi.post("/", AdminFormsCreate);
openapi.route("/:formKey", formKey_Router);

export default openapi;
