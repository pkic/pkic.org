import { Hono } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../../_lib/http";
import speakers_Router from "./speakers/router";
import { proposalAccessCoSpeakerCreateRouteSchema } from "../../../../../../assets/shared/schemas/route-contracts-public-proposals";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { handleCoSpeakerInvite } from "./speakers";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post(
  "/speakers",
  openApiRoute(
    proposalAccessCoSpeakerCreateRouteSchema,
    (c, data) => handleCoSpeakerInvite(c, data.body),
    (c) => c.set("sensitive", true),
  ),
);
openapi.route("/speakers", speakers_Router);
app.all("/speakers", () => methodNotAllowed(["POST"]));

export default openapi;
