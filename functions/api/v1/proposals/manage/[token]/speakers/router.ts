import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ProposalsManageTokenSpeakersRemindPost } from "./remind";
import { ProposalsManageTokenSpeakerPatch } from "./[userId]";
import { onRequestDelete as ProposalsManageTokenSpeakerDelete_l } from "./[userId]";
import { proposerManagedSpeakerDeleteRouteSchema } from "../../../../../../../assets/shared/schemas/route-contracts";
import { openApiRoute } from "../../../../../../_lib/openapi/route";
import { methodNotAllowed } from "../../../../../../_lib/http";
import {
  ProposerManagedSpeakerHeadshotDelete,
  ProposerManagedSpeakerHeadshotGet,
  ProposerManagedSpeakerHeadshotPut,
} from "./[userId]/headshot";

const app = new Hono();
export const openapi = fromHono(app);

openapi.post("/remind", ProposalsManageTokenSpeakersRemindPost);
openapi.patch("/:userId", ProposalsManageTokenSpeakerPatch);
openapi.delete("/:userId", openApiRoute(proposerManagedSpeakerDeleteRouteSchema, ProposalsManageTokenSpeakerDelete_l));
openapi.get("/:userId/headshot", ProposerManagedSpeakerHeadshotGet);
openapi.put("/:userId/headshot", ProposerManagedSpeakerHeadshotPut);
openapi.delete("/:userId/headshot", ProposerManagedSpeakerHeadshotDelete);
app.all("/remind", () => methodNotAllowed(["POST"]));
app.all("/:userId", () => methodNotAllowed(["PATCH", "DELETE"]));

export default openapi;
