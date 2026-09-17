import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AuditLogList } from "./index";
import { AuditFilterOptions } from "./filters";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/", AuditLogList);
openapi.get("/filters", AuditFilterOptions);

export default openapi;
