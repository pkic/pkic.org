import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import { CurrentUserGroupsGet } from "./index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", CurrentUserGroupsGet);

export default openapi;
