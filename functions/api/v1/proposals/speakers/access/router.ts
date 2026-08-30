import { Hono } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../../_lib/http";
import type { RequestDbContext } from "../../../../../_lib/db/context";
import {
  ProposalSpeakerAccessGet,
  ProposalSpeakerAccessParticipationPatch,
  ProposalSpeakerAccessProfilePatch,
} from "./[token]";
import token_Router from "./[token]/router";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

app.use("*", async (c, next) => {
  c.set("sensitive", true);
  await next();
});

openapi.get("/:token", ProposalSpeakerAccessGet);
openapi.patch("/:token/participation", ProposalSpeakerAccessParticipationPatch);
openapi.patch("/:token/profile", ProposalSpeakerAccessProfilePatch);
openapi.route("/:token", token_Router);
app.all("/:token", () => methodNotAllowed(["GET"]));
app.all("/:token/participation", () => methodNotAllowed(["PATCH"]));
app.all("/:token/profile", () => methodNotAllowed(["PATCH"]));

export default openapi;
