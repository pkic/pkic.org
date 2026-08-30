import { Hono } from "hono";
import { fromHono } from "chanfana";
import { ProposalSpeakerHeadshotDelete, ProposalSpeakerHeadshotGet, ProposalSpeakerHeadshotPut } from "./headshot";
import { SpeakerPresentationGet, SpeakerPresentationPut } from "./presentation";
import { ProposalSpeakerReminderPreferencePatch } from "./reminder-preferences";
import { methodNotAllowed } from "../../../../../../_lib/http";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/headshot", ProposalSpeakerHeadshotGet);
openapi.put("/headshot", ProposalSpeakerHeadshotPut);
openapi.delete("/headshot", ProposalSpeakerHeadshotDelete);
openapi.get("/presentation", SpeakerPresentationGet);
openapi.put("/presentation", SpeakerPresentationPut);
openapi.patch("/reminder-preferences", ProposalSpeakerReminderPreferencePatch);
app.all("/headshot", () => methodNotAllowed(["GET", "PUT", "DELETE"]));
app.all("/presentation", () => methodNotAllowed(["GET", "PUT"]));
app.all("/reminder-preferences", () => methodNotAllowed(["PATCH"]));

export default openapi;
