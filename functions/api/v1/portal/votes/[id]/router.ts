import { Hono } from "hono";
import { fromHono } from "chanfana";
import { PortalVoteGet } from "./index";
import { PortalVoteBallotsPost } from "./ballots";
import { PortalVoteResultsGet } from "./results";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", PortalVoteGet);
openapi.post("/ballots", PortalVoteBallotsPost);
openapi.get("/results", PortalVoteResultsGet);

export default openapi;
