import { Hono } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../_lib/http";
import { EventFormsGet } from "./forms";
import { EventsEventSlugInvitesPost } from "./invites";
import { EventsEventSlugProposalsPost } from "./proposals";
import { EventsEventSlugRegistrationsPost } from "./registrations";
import { EventsEventSlugSpeakerInvitesPost } from "./speaker-invites";
import { TermsGet } from "./terms";
import proposals_Router from "./proposals/router";
import registrations_Router from "./registrations/router";

const app = new Hono();
export const openapi = fromHono(app);

openapi.get("/forms", EventFormsGet);
openapi.post("/invites", EventsEventSlugInvitesPost);
openapi.post("/proposals", EventsEventSlugProposalsPost);
openapi.post("/registrations", EventsEventSlugRegistrationsPost);
openapi.post("/speaker-invites", EventsEventSlugSpeakerInvitesPost);
openapi.get("/terms", TermsGet);
openapi.route("/proposals", proposals_Router);
openapi.route("/registrations", registrations_Router);
app.all("/registrations", () => methodNotAllowed(["POST"]));

export default openapi;
