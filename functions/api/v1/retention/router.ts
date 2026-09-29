import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { RetentionDueList } from "./due/index";
import { RetentionRunCreate } from "./runs/index";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/due", RetentionDueList);
openapi.post("/runs", RetentionRunCreate);

export default openapi;
