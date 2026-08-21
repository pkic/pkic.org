import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPost as ProposalsManageTokenSpeakersRemindPost_l } from "./remind";
import { onRequestPatch as ProposalsManageTokenSpeakerPatch_l } from "./[userId]";
import {
  ProposerManagedSpeakerHeadshotDelete,
  ProposerManagedSpeakerHeadshotGet,
  ProposerManagedSpeakerHeadshotPut,
} from "./[userId]/headshot";

const app = new Hono();
export const openapi = fromHono(app);

app.post("/remind", ProposalsManageTokenSpeakersRemindPost_l);
app.patch("/:userId", ProposalsManageTokenSpeakerPatch_l);
openapi.get("/:userId/headshot", ProposerManagedSpeakerHeadshotGet);
openapi.put("/:userId/headshot", ProposerManagedSpeakerHeadshotPut);
openapi.delete("/:userId/headshot", ProposerManagedSpeakerHeadshotDelete);

export default openapi;
