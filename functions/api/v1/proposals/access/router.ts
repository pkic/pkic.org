import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ProposalAccessGet, ProposalAccessPatch } from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/:token", ProposalAccessGet);
openapi.patch("/:token", ProposalAccessPatch);
openapi.route("/:token", token_Router);

export default openapi;
