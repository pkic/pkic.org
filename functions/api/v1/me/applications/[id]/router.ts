import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MeApplicationEcDecisionPost } from "./ec-decision";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/ec-decision", MeApplicationEcDecisionPost);

export default openapi;
