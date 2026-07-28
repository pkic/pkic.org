import { Hono } from "hono";
import { fromHono } from "chanfana";
import votes_Router from "./votes/router";
import voteProposals_Router from "./vote-proposals/router";
import type { RequestDbContext } from "../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.route("/votes", votes_Router);
openapi.route("/vote-proposals", voteProposals_Router);

export default openapi;
