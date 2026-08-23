import { Hono } from "hono";
import { fromHono } from "chanfana";
import {
  adminProposalSpeakerDeleteRouteSchema,
  adminProposalSpeakerPatchRouteSchema,
} from "../../../../../../../assets/shared/schemas/route-contracts";
import { handleError } from "../../../../../../_lib/http";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { onRequestDelete as AdminSpeakerDelete, onRequestPatch as AdminSpeakerPatch } from "./[userId]";
import { AdminProposalSpeakerRemindPost } from "./[userId]/remind";
import { AdminProposalSpeakerRemindPresentationPost } from "./[userId]/remind-presentation";
import {
  AdminProposalSpeakerHeadshotDelete,
  AdminProposalSpeakerHeadshotGet,
  AdminProposalSpeakerHeadshotPut,
} from "./[userId]/headshot";
import { AdminProposalSpeakerGravatarPost } from "./[userId]/gravatar";
import type { RequestDbContext } from "../../../../../../_lib/db/context";

const app = new Hono<RequestDbContext>();
app.onError((error, _c) => handleError(error));
export const openapi = fromHono(app);

openapi.patch("/:userId", openApiRoute(adminProposalSpeakerPatchRouteSchema, AdminSpeakerPatch));
openapi.delete("/:userId", openApiRoute(adminProposalSpeakerDeleteRouteSchema, AdminSpeakerDelete));
openapi.post("/:userId/remind", AdminProposalSpeakerRemindPost);
openapi.post("/:userId/remind-presentation", AdminProposalSpeakerRemindPresentationPost);
openapi.get("/:userId/headshot", AdminProposalSpeakerHeadshotGet);
openapi.put("/:userId/headshot", AdminProposalSpeakerHeadshotPut);
openapi.delete("/:userId/headshot", AdminProposalSpeakerHeadshotDelete);
openapi.post("/:userId/gravatar", AdminProposalSpeakerGravatarPost);

export default openapi;
