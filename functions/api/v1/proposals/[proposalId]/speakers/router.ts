import { Hono } from "hono";
import { fromHono } from "chanfana";
import {
  proposalSpeakerDeleteRouteSchema,
  proposalSpeakerPatchRouteSchema,
  proposalSpeakerReminderRouteSchema,
} from "../../../../../../assets/shared/schemas/route-contracts";
import { handleError } from "../../../../../_lib/http";
import { openApiRoute } from "../../../../../_lib/openapi/route";
import { sendProposalReminder } from "../../../../../_lib/routes/proposal-reminders";
import { onRequestDelete as deleteProposalSpeaker, onRequestPatch as patchProposalSpeaker } from "./[userId]";
import {
  ProposalSpeakerHeadshotDelete,
  ProposalSpeakerHeadshotGet,
  ProposalSpeakerHeadshotPut,
} from "./[userId]/headshot";
import { ProposalSpeakerGravatarPost } from "./[userId]/gravatar";
import type { AdminContext, RequestDbContext } from "../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.patch("/:userId", openApiRoute(proposalSpeakerPatchRouteSchema, patchProposalSpeaker));
openapi.delete("/:userId", openApiRoute(proposalSpeakerDeleteRouteSchema, deleteProposalSpeaker));
openapi.post(
  "/:userId/reminders",
  openApiRoute(proposalSpeakerReminderRouteSchema, async (c: AdminContext, data) =>
    sendProposalReminder(c, data.body.kind, data.params.userId, data.params.proposalId),
  ),
);
openapi.get("/:userId/headshot", ProposalSpeakerHeadshotGet);
openapi.put("/:userId/headshot", ProposalSpeakerHeadshotPut);
openapi.delete("/:userId/headshot", ProposalSpeakerHeadshotDelete);
openapi.post("/:userId/headshot", ProposalSpeakerGravatarPost);

export default openapi;
