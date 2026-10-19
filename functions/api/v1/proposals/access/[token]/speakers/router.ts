import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ProposalAccessSpeakerReminderCreate } from "./[userId]/reminders";
import { ProposalAccessSpeakerPatch } from "./[userId]";
import { onRequestDelete as ProposalAccessSpeakerDeleteHandler } from "./[userId]";
import { proposalAccessSpeakerDeleteRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { methodNotAllowed } from "../../../../../../_lib/http";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/:userId/reminders", ProposalAccessSpeakerReminderCreate);
openapi.patch("/:userId", ProposalAccessSpeakerPatch);
openapi.delete("/:userId", openApiRoute(proposalAccessSpeakerDeleteRouteSchema, ProposalAccessSpeakerDeleteHandler));
app.all("/:userId/reminders", () => methodNotAllowed(["POST"]));
app.all("/:userId", () => methodNotAllowed(["PATCH", "DELETE"]));

export default openapi;
