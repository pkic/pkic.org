import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as ProposalsManageTokenSpeakersRemindPost_l } from "./remind";
import { onRequestPatch as ProposalsManageTokenSpeakerPatch_l } from "./[userId]";
import { onRequestDelete as ProposalsManageTokenSpeakerDelete_l } from "./[userId]";
import { proposerManagedSpeakerDeleteRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import {
  ProposerManagedSpeakerHeadshotDelete,
  ProposerManagedSpeakerHeadshotGet,
  ProposerManagedSpeakerHeadshotPut,
} from "./[userId]/headshot";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/remind", ProposalsManageTokenSpeakersRemindPost_l);
app.patch("/:userId", ProposalsManageTokenSpeakerPatch_l);
openapi.delete("/:userId", openApiRoute(proposerManagedSpeakerDeleteRouteSchema, ProposalsManageTokenSpeakerDelete_l));
openapi.get("/:userId/headshot", ProposerManagedSpeakerHeadshotGet);
openapi.put("/:userId/headshot", ProposerManagedSpeakerHeadshotPut);
openapi.delete("/:userId/headshot", ProposerManagedSpeakerHeadshotDelete);

export default openapi;
