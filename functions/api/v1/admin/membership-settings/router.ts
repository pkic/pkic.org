import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MembershipSettingsGet, MembershipSettingsUpdate } from "./index";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MembershipSettingsGet);
openapi.patch("/", MembershipSettingsUpdate);

export default openapi;
