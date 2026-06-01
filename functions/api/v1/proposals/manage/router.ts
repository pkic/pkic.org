import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as ProposalsManageTokenGet_l } from "./[token]";
import { onRequestPatch as ProposalsManageTokenPatch_l } from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/:token", ProposalsManageTokenGet_l);
app.patch("/:token", ProposalsManageTokenPatch_l);
openapi.route("/:token", token_Router);

export default openapi;
