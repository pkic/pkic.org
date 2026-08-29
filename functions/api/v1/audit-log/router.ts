import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AuditLogList } from "./index";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", AuditLogList);

export default openapi;
