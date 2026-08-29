import { Hono } from "hono";
import { fromHono } from "chanfana";
import manage_Router from "./manage/router";
import speaker_Router from "./speaker/router";
import proposal_Router from "./[proposalId]/router";
import { ProposalProgramsList } from "./programs";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/manage", manage_Router);
openapi.route("/speaker", speaker_Router);
openapi.get("/programs", ProposalProgramsList);
openapi.route("/:proposalId", proposal_Router);

export default openapi;
