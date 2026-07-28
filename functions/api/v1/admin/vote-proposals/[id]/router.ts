import { Hono } from "hono";
import { fromHono } from "chanfana";
import { AdminVoteProposalGet } from "./index";
import { AdminVoteProposalApprovePost } from "./approve";
import { AdminVoteProposalRejectPost } from "./reject";
import type { RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/", AdminVoteProposalGet);
openapi.post("/approve", AdminVoteProposalApprovePost);
openapi.post("/reject", AdminVoteProposalRejectPost);

export default openapi;
