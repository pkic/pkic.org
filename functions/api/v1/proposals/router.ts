import { Hono } from "hono";
import { fromHono } from "chanfana";
import access_Router from "./access/router";
import speakerAccess_Router from "./speakers/access/router";
import proposal_Router from "./[proposalId]/router";
import { ProposalProgramsList } from "./programs";

const app = new Hono();
export const openapi = fromHono(app);

openapi.route("/access", access_Router);
openapi.route("/speakers/access", speakerAccess_Router);
openapi.get("/programs", ProposalProgramsList);
openapi.route("/:proposalId", proposal_Router);

export default openapi;
