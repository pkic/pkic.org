import { Hono } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../_lib/http";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { ProposalsSpeakerTokenGet, ProposalsSpeakerTokenPatch, ProposalsSpeakerTokenPost } from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  c.set("sensitive", true);
  await next();
});

openapi.get("/:token", ProposalsSpeakerTokenGet);
openapi.post("/:token", ProposalsSpeakerTokenPost);
openapi.patch("/:token", ProposalsSpeakerTokenPatch);
openapi.route("/:token", token_Router);
app.all("/:token", () => methodNotAllowed(["GET", "POST", "PATCH"]));

export default openapi;
