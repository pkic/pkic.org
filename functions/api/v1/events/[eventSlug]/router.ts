import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../_lib/http";
import { EventFormsCreatePost, EventFormsListGet } from "./forms";
import { EventFormPlacementGet } from "./forms/placements";
import { EventsEventSlugInvitesPost } from "./invites";
import { EventsEventSlugProposalsPost } from "./proposals";
import { EventsEventSlugRegistrationsPost } from "./registrations";
import { EventSpeakerInvitationsPost } from "./speakers/invitations";
import { TermsGet } from "./terms";
import { EventSponsorTiersGet, EventSponsorTiersPut } from "./sponsors/tiers";
import { EventDetailGet } from "./index";
import { EventSettingsPatch } from "./settings";
import { EventDaysGet, EventDaysPut } from "./days";
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

async function requireEventManagementIdentity(c: Context<RequestDbContext>, next: Next) {
  await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await next();
}

// The resolved active placement is intentionally public and must be mounted
// before the authenticated event-form management subtree.
openapi.get("/forms/placements/:purpose", EventFormPlacementGet);

app.use("/settings", requireEventManagementIdentity);
app.use("/days", requireEventManagementIdentity);

app.use("/forms", requireEventFormsIdentity);
app.use("/forms/*", requireEventFormsIdentity);

openapi.get("/forms", EventFormsListGet);
openapi.post("/forms", EventFormsCreatePost);
openapi.route("/forms/:formKey", eventForms_Router);
openapi.post("/invites", EventsEventSlugInvitesPost);
openapi.post("/proposals", EventsEventSlugProposalsPost);
openapi.post("/registrations", EventsEventSlugRegistrationsPost);
openapi.post("/speakers/invitations", EventSpeakerInvitationsPost);
openapi.get("/terms", TermsGet);
openapi.get("/sponsors/tiers", EventSponsorTiersGet);
openapi.put("/sponsors/tiers", EventSponsorTiersPut);
openapi.route("/proposals", proposals_Router);
openapi.route("/registrations", registrations_Router);
openapi.get("/days", EventDaysGet);
openapi.put("/days", EventDaysPut);
openapi.patch("/settings", EventSettingsPatch);
openapi.get("/", EventDetailGet);
app.all("/registrations", () => methodNotAllowed(["POST"]));

export default openapi;
