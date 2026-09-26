import { Hono } from "hono";
import { fromHono } from "chanfana";
import access_Router from "./access/router";
import speakerAccess_Router from "./speakers/access/router";
import proposal_Router from "./[proposalId]/router";
import { ProposalProgramsList } from "./programs";

import submissionRouter from "./[proposalId]/submission/router";
import participationRouter from "./[proposalId]/participation/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/access", access_Router);
openapi.route("/speakers/access", speakerAccess_Router);
openapi.get("/programs", ProposalProgramsList);
openapi.route("/:proposalId/submission", submissionRouter);
openapi.route("/:proposalId/participation", participationRouter);
openapi.route("/:proposalId", proposal_Router);

export default openapi;
