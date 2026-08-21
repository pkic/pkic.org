import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ProposalsManageTokenGet, ProposalsManageTokenPatch } from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/:token", ProposalsManageTokenGet);
openapi.patch("/:token", ProposalsManageTokenPatch);
openapi.route("/:token", token_Router);

export default openapi;
