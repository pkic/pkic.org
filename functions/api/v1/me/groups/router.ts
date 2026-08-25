import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { MeGroupsGet } from "./index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MeGroupsGet);

export default openapi;
