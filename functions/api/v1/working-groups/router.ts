import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WorkingGroupsGet } from "./index";
import { WorkingGroupIdGet } from "./[id]";
import { WorkingGroupMeetingsGet } from "./[id]/meetings";
import { WorkingGroupMembersGet } from "./[id]/members";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", WorkingGroupsGet);
openapi.get("/:wgId/meetings", WorkingGroupMeetingsGet);
openapi.get("/:wgId/members", WorkingGroupMembersGet);
openapi.get("/:id", WorkingGroupIdGet);

export default openapi;
