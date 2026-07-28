import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminVotePatch } from "./index";
import { AdminVoteVisibilityPatch } from "./visibility";
import { AdminVoteBallotsGet } from "./ballots";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.patch("/", AdminVotePatch);
openapi.patch("/visibility", AdminVoteVisibilityPatch);
openapi.get("/ballots", AdminVoteBallotsGet);

export default openapi;
