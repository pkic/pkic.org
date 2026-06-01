import { Hono } from "hono";
import { fromHono } from "chanfana";
import { onRequestGet as FormsGet_l } from "./forms";
import { EventsEventSlugInvitesPost } from "./invites";
import { EventsEventSlugProposalsPost } from "./proposals";
import { onRequestPost as EventsEventSlugRegistrationsPost_l } from "./registrations";
import { EventsEventSlugSpeakerInvitesPost } from "./speaker-invites";
import { TermsGet } from "./terms";
import proposals_Router from "./proposals/router";
import registrations_Router from "./registrations/router";

const app = new Hono();
export const openapi = fromHono(app);

app.get("/forms", FormsGet_l);
openapi.post("/invites", EventsEventSlugInvitesPost);
openapi.post("/proposals", EventsEventSlugProposalsPost);
app.post("/registrations", EventsEventSlugRegistrationsPost_l);
openapi.post("/speaker-invites", EventsEventSlugSpeakerInvitesPost);
openapi.get("/terms", TermsGet);
openapi.route("/proposals", proposals_Router);
openapi.route("/registrations", registrations_Router);

export default openapi;
