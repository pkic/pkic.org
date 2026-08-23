import { Hono } from "hono";
import { fromHono } from "chanfana";
import speakers_Router from "./speakers/router";
import { coSpeakerInviteRouteSchema } from "../../../../../../assets/shared/schemas/proposal-management";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { handleCoSpeakerInvite } from "./speakers";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post(
  "/speakers",
  openApiRoute(
    coSpeakerInviteRouteSchema,
    (c, data) => handleCoSpeakerInvite(c, data.body),
    (c) => c.set("sensitive", true),
  ),
);
openapi.route("/speakers", speakers_Router);

export default openapi;
