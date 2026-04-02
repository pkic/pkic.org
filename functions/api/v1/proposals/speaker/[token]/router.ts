import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestPut as proposalSpeakerHeadshotPut_l } from "./headshot";
import { onRequestPut as ProposalsSpeakerTokenPresentationPut_l } from "./presentation";
import { onRequestPost as ProposalsSpeakerTokenRemindersPost_l } from "./reminders";

const app = new Hono();
export const openapi = fromHono(app);

app.put("/headshot", proposalSpeakerHeadshotPut_l);
app.put("/presentation", ProposalsSpeakerTokenPresentationPut_l);
app.post("/reminders", ProposalsSpeakerTokenRemindersPost_l);

export default app;
