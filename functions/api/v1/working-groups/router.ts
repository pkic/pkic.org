import { Hono } from "hono";
import { fromHono } from "chanfana";
import { WorkingGroupsGet } from "./index";
import { WorkingGroupIdGet } from "./[id]";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", WorkingGroupsGet);
openapi.get("/:id", WorkingGroupIdGet);

export default openapi;
