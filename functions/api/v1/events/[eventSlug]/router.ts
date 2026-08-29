import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../_lib/http";
import { EventFormsCreatePost, EventFormsListGet } from "./forms";
import { EventFormConfigurationGet } from "./form-configurations";
import { EventsEventSlugInvitesPost } from "./invites";
import { EventsEventSlugProposalsPost } from "./proposals";
import { EventsEventSlugRegistrationsPost } from "./registrations";
import { EventsEventSlugSpeakerInvitesPost } from "./speaker-invites";
import { TermsGet } from "./terms";
import { EventSponsorTiersGet, EventSponsorTiersPut } from "./sponsor-tiers";
import proposals_Router from "./proposals/router";
import registrations_Router from "./registrations/router";
import eventForms_Router from "./forms/[formKey]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { requestDb } from "../../../../_lib/db/context";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

async function requireEventFormsIdentity(c: Context<RequestDbContext>, next: Next) {
  await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await next();
}

app.use("/forms", requireEventFormsIdentity);
app.use("/forms/*", requireEventFormsIdentity);

openapi.get("/forms", EventFormsListGet);
openapi.post("/forms", EventFormsCreatePost);
openapi.route("/forms/:formKey", eventForms_Router);
openapi.get("/form-configurations/:purpose", EventFormConfigurationGet);
openapi.post("/invites", EventsEventSlugInvitesPost);
openapi.post("/proposals", EventsEventSlugProposalsPost);
openapi.post("/registrations", EventsEventSlugRegistrationsPost);
openapi.post("/speaker-invites", EventsEventSlugSpeakerInvitesPost);
openapi.get("/terms", TermsGet);
openapi.get("/sponsor-tiers", EventSponsorTiersGet);
openapi.put("/sponsor-tiers", EventSponsorTiersPut);
openapi.route("/proposals", proposals_Router);
openapi.route("/registrations", registrations_Router);
app.all("/registrations", () => methodNotAllowed(["POST"]));

export default openapi;
