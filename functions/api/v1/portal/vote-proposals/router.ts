import { Hono } from "hono";
import { fromHono } from "chanfana";
import { PortalVoteProposalsPost, PortalVoteProposalsGet } from "./index";
import id_Router from "./[id]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.post("/", PortalVoteProposalsPost);
openapi.get("/", PortalVoteProposalsGet);
openapi.route("/:id", id_Router);

export default openapi;
