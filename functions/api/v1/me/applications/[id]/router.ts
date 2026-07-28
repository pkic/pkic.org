import { Hono } from "hono";
import { fromHono } from "chanfana";
import { MeApplicationGet } from "./index";
import { MeApplicationEcDecisionPost } from "./ec-decision";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", MeApplicationGet);
openapi.post("/ec-decision", MeApplicationEcDecisionPost);

export default openapi;
