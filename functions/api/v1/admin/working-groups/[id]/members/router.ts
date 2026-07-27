import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WorkingGroupMemberAdd } from "./index";
import { WorkingGroupMemberRemove } from "./[userId]";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/", WorkingGroupMemberAdd);
openapi.delete("/:userId", WorkingGroupMemberRemove);

export default openapi;
