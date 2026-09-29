import { fromHono } from "chanfana";
import { Hono } from "hono";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import campaignsRouter from "./campaigns/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/campaigns", campaignsRouter);

export default openapi;
