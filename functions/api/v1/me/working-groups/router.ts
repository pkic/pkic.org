import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MeWorkingGroupsGet } from "./index";
import { MeWorkingGroupJoinPost, MeWorkingGroupLeaveDelete } from "./[wgId]";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MeWorkingGroupsGet);
openapi.post("/:wgId", MeWorkingGroupJoinPost);
openapi.delete("/:wgId", MeWorkingGroupLeaveDelete);

export default openapi;
