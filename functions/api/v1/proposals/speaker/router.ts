import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { onRequestGet as ProposalsSpeakerTokenGet_l } from "./[token]";
import { onRequestPost as ProposalsSpeakerTokenPost_l } from "./[token]";
import { onRequestPatch as ProposalsSpeakerTokenPatch_l } from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  c.set("sensitive", true);
  await next();
});

app.get("/:token", ProposalsSpeakerTokenGet_l);
app.post("/:token", ProposalsSpeakerTokenPost_l);
app.patch("/:token", ProposalsSpeakerTokenPatch_l);
openapi.route("/:token", token_Router);

export default openapi;
