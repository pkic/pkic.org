import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { SystemAuditLogList } from "./audit-log";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/audit-log", SystemAuditLogList);

export default openapi;
