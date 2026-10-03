import { Hono, type Context, type Next } from "hono";
import { fromHono } from "chanfana";
import { methodNotAllowed } from "../../../../_lib/http";
import { EventFormsCreatePost, EventFormsListGet } from "./forms";
import { EventFormPlacementGet } from "./forms/placements";
import { EventsEventSlugInvitesPost } from "./invites";
import { EventProposalsListGet, EventsEventSlugProposalsPost } from "./proposals";
import { EventsEventSlugRegistrationsPost } from "./registrations";
import { EventSpeakerInvitationsPost } from "./speakers/invitations";
import { EventProposalSpeakersListGet } from "./speakers";
import { TermsGet } from "./terms";
import { EventSponsorTiersGet, EventSponsorTiersPut } from "./sponsors/tiers";
import { EventDetailGet } from "./index";
import { EventSettingsPatch } from "./settings";
import { EventDaysGet, EventDaysPut } from "./days";
import { EventTeamRoleCreate, EventTeamRolesList } from "./roles";
import { EventTeamRoleDelete } from "./roles/[roleAssignmentId]";
import { EventPromotersList } from "./promoters";
import { EventPresentationArchiveGet } from "./presentations/archive";
import { EventAnalyticsGet } from "./analytics";
import {
  AgendaGet,
  AgendaSettingsPost,
  AgendaPeopleGet,
  AgendaOccurrencesGet,
  AgendaRoomCreate,
  AgendaOccurrenceCreate,
  AgendaOccurrencePatch,
  AgendaSwap,
  AgendaStaffing,
  AgendaAllocation,
  AgendaPublication,
  AgendaImport,
} from "./agenda";
import { SponsorLeadsExportGet } from "./lead-export";
import { EventAttendanceGet, EventSponsorLeadCreate, SessionAttendancePeopleGet } from "./attendance";
import {
  SessionParticipationPut,
  PersonalAgendaGet,
  SessionParticipationReviewPut,
  SessionBookingsGet,
} from "./participation";
import { EventBadgeCreate, EventBadgeDelete, EventBadgeAttendeesGet } from "./badges";
import { EventScanCreate, ScannerTargetsGet } from "./scans";
import { OfflineEligibilityGet } from "./offline-eligibility";
import emailRouter from "./email/router";
import proposals_Router from "./proposals/router";
import registrations_Router from "./registrations/router";
import eventForms_Router from "./forms/[formKey]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { requestDb } from "../../../../_lib/db/context";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { publicReadRoute } from "../../../../_lib/cache/public-read";

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
app.use("/roles", requireEventManagementIdentity);
app.use("/roles/*", requireEventManagementIdentity);
app.use("/promoters", requireEventManagementIdentity);
app.use("/presentations/archive", requireEventManagementIdentity);
app.use("/analytics", requireEventManagementIdentity);
app.use("/email", requireEventManagementIdentity);
app.use("/email/*", requireEventManagementIdentity);

app.use("/forms", requireEventFormsIdentity);
app.use("/forms/*", requireEventFormsIdentity);

openapi.get("/forms", EventFormsListGet);
openapi.post("/forms", EventFormsCreatePost);
openapi.route("/forms/:formKey", eventForms_Router);
openapi.post("/invites", EventsEventSlugInvitesPost);
openapi.post("/proposals", EventsEventSlugProposalsPost);
openapi.get("/proposals", EventProposalsListGet);
openapi.post("/registrations", EventsEventSlugRegistrationsPost);
openapi.post("/speakers/invitations", EventSpeakerInvitationsPost);
openapi.get("/speakers", EventProposalSpeakersListGet);
openapi.get("/terms", publicReadRoute(TermsGet));
openapi.get("/sponsors/tiers", EventSponsorTiersGet);
openapi.put("/sponsors/tiers", EventSponsorTiersPut);
openapi.get("/roles", EventTeamRolesList);
openapi.post("/roles", EventTeamRoleCreate);
openapi.delete("/roles/:roleAssignmentId", EventTeamRoleDelete);
openapi.get("/promoters", EventPromotersList);
openapi.get("/presentations/archive", EventPresentationArchiveGet);
openapi.get("/analytics", EventAnalyticsGet);
openapi.get("/agenda", AgendaGet);
openapi.post("/agenda/settings", AgendaSettingsPost);
openapi.get("/agenda/people", AgendaPeopleGet);
openapi.get("/agenda/occurrences", AgendaOccurrencesGet);
openapi.post("/agenda/rooms", AgendaRoomCreate);
openapi.post("/agenda/occurrences", AgendaOccurrenceCreate);
openapi.patch("/agenda/occurrences/:occurrenceId", AgendaOccurrencePatch);
openapi.post("/agenda/swaps", AgendaSwap);
openapi.post("/agenda/staffing", AgendaStaffing);
openapi.post("/agenda/allocations", AgendaAllocation);
openapi.post("/agenda/publications", AgendaPublication);
openapi.post("/agenda/imports", AgendaImport);
openapi.post("/scans", EventScanCreate);
openapi.get("/scans/targets", ScannerTargetsGet);
openapi.get("/offline-eligibility", OfflineEligibilityGet);
openapi.get("/badges/attendees", EventBadgeAttendeesGet);
openapi.post("/badges", EventBadgeCreate);
openapi.delete("/badges/:badgeId", EventBadgeDelete);
openapi.get("/agenda/:occurrenceId/participation", SessionBookingsGet);
openapi.get("/agenda/:occurrenceId/attendance", SessionAttendancePeopleGet);
openapi.put("/agenda/:occurrenceId/participation", SessionParticipationPut);
openapi.put("/agenda/:occurrenceId/participation/:userId", SessionParticipationReviewPut);
openapi.get("/agenda/participation", PersonalAgendaGet);
openapi.get("/attendance", EventAttendanceGet);
openapi.get("/sponsors/:sponsorId/leads.csv", SponsorLeadsExportGet);
openapi.post("/sponsors/:sponsorId/leads", EventSponsorLeadCreate);
openapi.route("/email", emailRouter);
openapi.route("/proposals", proposals_Router);
openapi.route("/registrations", registrations_Router);
openapi.get("/days", EventDaysGet);
openapi.put("/days", EventDaysPut);
openapi.patch("/settings", EventSettingsPatch);
openapi.get("/", publicReadRoute(EventDetailGet));
app.all("/registrations", () => methodNotAllowed(["GET", "POST"]));

export default openapi;
