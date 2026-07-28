import { Hono } from "hono";
import { fromHono } from "chanfana";
import { PortalVoteProposalGet, PortalVoteProposalDelete } from "./index";
import { PortalVoteProposalEndorsePost, PortalVoteProposalEndorseDelete } from "./endorse";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", PortalVoteProposalGet);
openapi.delete("/", PortalVoteProposalDelete);
openapi.post("/endorse", PortalVoteProposalEndorsePost);
openapi.delete("/endorse", PortalVoteProposalEndorseDelete);

export default openapi;
