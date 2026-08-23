import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ProposalSpeakerHeadshotDelete, ProposalSpeakerHeadshotGet, ProposalSpeakerHeadshotPut } from "./headshot";
import { SpeakerPresentationPut } from "./presentation";
import { onRequestGet as ProposalsSpeakerTokenPresentationDownloadGet_l } from "./presentation/download";
import { ProposalSpeakerReminderPreferencePost } from "./reminders";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/headshot", ProposalSpeakerHeadshotGet);
openapi.put("/headshot", ProposalSpeakerHeadshotPut);
openapi.delete("/headshot", ProposalSpeakerHeadshotDelete);
openapi.put("/presentation", SpeakerPresentationPut);
app.get("/presentation/download", ProposalsSpeakerTokenPresentationDownloadGet_l);
openapi.post("/reminders", ProposalSpeakerReminderPreferencePost);

export default openapi;
