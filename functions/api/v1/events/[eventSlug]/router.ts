import { AgendaRoomsOrderPost } from "./agenda/rooms";
import { AgendaBreaksPost } from "./agenda/breaks";
import { AgendaSponsorChoicesGet } from "./agenda/sponsors";
import { registerAgendaReadRoutes } from "./agenda/register-read-routes";
import sessionPresentationsRouter from "./agenda/session-presentations-router";
import {
  AppearanceOverridesGet,
  AppearanceOverrideRequestPost,
  AppearanceOverrideReviewPost,
} from "./agenda/appearance-overrides";
import { AttendanceImportsGet, AttendanceImportReviewCreate, AttendanceImportCreate } from "./attendance-imports";
import {
  AgendaTransferExportGet,
  AgendaTransferReviewPost,
  AgendaTransferApplyPost,
  AgendaTransferIdentitiesGet,
} from "./agenda/transfer";
import {
  AttendanceEvidenceGet,
  AttendanceCorrectionHistoryGet,
  AttendanceCorrectionCreate,
} from "./attendance-corrections";
import { SessionRoomRecommendationsGet } from "./room-recommendations";
import {
  AgendaContentsGet,
  AgendaContentCreate,
  AgendaContentPatch,
  AgendaContentPlace,
  AgendaOccurrencePlace,
  AgendaContentCopy,
} from "./agenda/content";
import {
  SessionInvitationPut,
  SessionDelegationPut,
  SessionInviteesGet,
  SessionManagementInfoGet,
  ManagedSessionsGet,
} from "./session-management";
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
  AgendaSettingsPost,
  AgendaRoomCreate,
  AgendaRoomUpdate,
  AgendaOccurrenceCreate,
  AgendaOccurrencePatch,
  AgendaSessionHistory,
  AgendaStaffing,
  AgendaAllocation,
  AgendaPublication,
  AgendaImport,
} from "./agenda";
import { SponsorLeadsExportGet } from "./lead-export";
import { SponsorLeadSponsorsGet, SponsorLeadsGet, SponsorLeadCapturesGet } from "./lead-list";
import { EventAttendanceGet, EventSponsorLeadCreate, SessionAttendancePeopleGet } from "./attendance";
import {
  AttendanceSummaryGet,
  AttendanceAttemptsGet,
  AttendanceReasonsGet,
  EventAttendancePeopleGet,
} from "./attendance-reporting";
import {
  AttendancePeopleExportGet,
  AttendanceAttemptsExportGet,
  AttendanceSummaryExportGet,
} from "./attendance-exports";
import { AgendaScheduleReviewPost, AgendaScheduleApplyPost } from "./agenda/schedule";
import {
  EventWebPushConfigurationGet,
  EventWebPushStatusGet,
  EventWebPushRegisterPost,
  EventWebPushRevokeDelete,
} from "./web-push";
import {
  SessionParticipationPut,
  PersonalAgendaGet,
  SessionVirtualRoomGet,
  SessionParticipationReviewPut,
  SessionBookingsGet,
  SessionHoldPost,
  SessionHoldsGet,
  SessionHoldDelete,
} from "./participation";
import { EventBadgeCreate, EventBadgeDelete, EventBadgeAttendeesGet, EventBadgesGet, EventBadgeGet } from "./badges";
import { EventScanCreate, ScannerTargetsGet } from "./scans";
import { ScannerSuggestionsGet } from "./scanner-suggestions";
import {
  AgendaCalendarRotatePost,
  AgendaCalendarRevokeDelete,
  AgendaCalendarFeedGet,
  AgendaCalendarSettingsGet,
  AgendaCalendarSettingsPut,
} from "./agenda-calendar";
import {
  PromotionKitGet,
  PromotionCopySave,
  PromotionArtifactGet,
  PromotionSessionsGet,
  PromotionRendersCreate,
} from "./agenda/promotion";
import { OfflineEligibilityGet } from "./offline-eligibility";
import {
  ScannerDeviceEnrollmentPost,
  ScannerDeviceStatusGet,
  ScannerDeviceClosingPost,
} from "./scanner-device-sessions";
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

async function requireEventManagementIdentity(c: Context<RequestDbContext>, next: Next) {
  await requireUserBackedAdminFromRequest(requestDb(c), c.req.raw, c.env);
  await next();
}

// The resolved active placement is intentionally public and must be mounted
// before the authenticated event-form management subtree.
openapi.get("/forms/placements/:purpose", EventFormPlacementGet);

app.use("/settings", requireEventManagementIdentity);
app.use("/agenda/transfers", requireEventManagementIdentity);
app.use("/agenda/transfers/*", requireEventManagementIdentity);
app.use("/agenda/occurrences/filters", requireEventManagementIdentity);
app.use("/days", requireEventManagementIdentity);
app.use("/roles", requireEventManagementIdentity);
app.use("/roles/*", requireEventManagementIdentity);
app.use("/promoters", requireEventManagementIdentity);
app.use("/presentations/archive", requireEventManagementIdentity);
app.use("/analytics", requireEventManagementIdentity);
app.use("/email", requireEventManagementIdentity);
app.use("/email/*", requireEventManagementIdentity);

app.use("/forms", requireEventManagementIdentity);
app.use("/forms/*", requireEventManagementIdentity);

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
registerAgendaReadRoutes(openapi);
openapi.post("/agenda/settings", AgendaSettingsPost);
openapi.get("/agenda/occurrences/:occurrenceId/room-recommendations", SessionRoomRecommendationsGet);
openapi.post("/agenda/rooms", AgendaRoomCreate);
openapi.post("/agenda/rooms/order", AgendaRoomsOrderPost);
openapi.put("/agenda/rooms/:roomId", AgendaRoomUpdate);
openapi.post("/agenda/occurrences", AgendaOccurrenceCreate);
openapi.post("/agenda/breaks", AgendaBreaksPost);
openapi.get("/agenda/sponsors", AgendaSponsorChoicesGet);
openapi.patch("/agenda/occurrences/:occurrenceId", AgendaOccurrencePatch);
openapi.post("/agenda/occurrences/:occurrenceId/history", AgendaSessionHistory);
openapi.get("/agenda/occurrences/:occurrenceId/appearance-overrides", AppearanceOverridesGet);
openapi.post("/agenda/occurrences/:occurrenceId/appearance-overrides", AppearanceOverrideRequestPost);
openapi.post(
  "/agenda/occurrences/:occurrenceId/appearance-overrides/:requestId/decisions",
  AppearanceOverrideReviewPost,
);
openapi.route("/agenda/occurrences/:occurrenceId/materials/presentations", sessionPresentationsRouter);

openapi.post("/agenda/schedule/reviews", AgendaScheduleReviewPost);
openapi.post("/agenda/schedule", AgendaScheduleApplyPost);
openapi.post("/agenda/staffing", AgendaStaffing);
openapi.post("/agenda/allocations", AgendaAllocation);
openapi.post("/agenda/publications", AgendaPublication);
openapi.post("/agenda/imports", AgendaImport);
openapi.get("/agenda/transfers/exports", AgendaTransferExportGet);
openapi.post("/agenda/transfers/reviews", AgendaTransferReviewPost);
openapi.post("/agenda/transfers", AgendaTransferApplyPost);
openapi.get("/agenda/transfers/identities", AgendaTransferIdentitiesGet);
openapi.get("/attendance/imports", AttendanceImportsGet);
openapi.post("/attendance/imports/reviews", AttendanceImportReviewCreate);
openapi.post("/attendance/imports", AttendanceImportCreate);
openapi.post("/scans", EventScanCreate);
openapi.post("/scanner/devices/sessions", ScannerDeviceEnrollmentPost);
openapi.get("/scanner/devices/sessions/:epochId", ScannerDeviceStatusGet);
openapi.post("/scanner/devices/sessions/:epochId/closing", ScannerDeviceClosingPost);
openapi.get("/scans/targets", ScannerTargetsGet);
openapi.get("/scans/suggestions", ScannerSuggestionsGet);
openapi.get("/offline-eligibility", OfflineEligibilityGet);
openapi.get("/calendar/settings", AgendaCalendarSettingsGet);
openapi.put("/calendar/settings", AgendaCalendarSettingsPut);
openapi.post("/calendar/subscriptions", AgendaCalendarRotatePost);
openapi.delete("/calendar/subscriptions", AgendaCalendarRevokeDelete);
openapi.get("/calendar/subscriptions/:token/calendar.ics", AgendaCalendarFeedGet);
openapi.get("/agenda/promotion", PromotionSessionsGet);
openapi.get("/agenda/occurrences/:occurrenceId/promotion", PromotionKitGet);
openapi.post("/agenda/occurrences/:occurrenceId/promotion", PromotionCopySave);
openapi.post("/agenda/occurrences/:occurrenceId/promotion/renders", PromotionRendersCreate);
openapi.get("/agenda/occurrences/:occurrenceId/promotion/artifact", PromotionArtifactGet);
openapi.get("/agenda/contents", AgendaContentsGet);
openapi.post("/agenda/contents", AgendaContentCreate);
openapi.post("/agenda/contents/copy", AgendaContentCopy);
openapi.patch("/agenda/contents/:contentId", AgendaContentPatch);
openapi.post("/agenda/contents/:contentId/placements", AgendaContentPlace);
openapi.post("/agenda/occurrences/:occurrenceId/placements", AgendaOccurrencePlace);
openapi.post("/agenda/:occurrenceId/holds", SessionHoldPost);
openapi.get("/agenda/:occurrenceId/holds", SessionHoldsGet);
openapi.delete("/agenda/:occurrenceId/holds/:holdId", SessionHoldDelete);
openapi.get("/badges/attendees", EventBadgeAttendeesGet);
openapi.get("/badges", EventBadgesGet);
openapi.get("/badges/:badgeId", EventBadgeGet);
openapi.post("/badges", EventBadgeCreate);
openapi.delete("/badges/:badgeId", EventBadgeDelete);
openapi.get("/agenda/:occurrenceId/participation", SessionBookingsGet);
openapi.get("/agenda/:occurrenceId/attendance", SessionAttendancePeopleGet);
openapi.put("/agenda/:occurrenceId/participation", SessionParticipationPut);
openapi.put("/agenda/:occurrenceId/participation/:userId", SessionParticipationReviewPut);
openapi.get("/agenda/participation", PersonalAgendaGet);
openapi.get("/agenda/occurrences/:occurrenceId/virtual-room", SessionVirtualRoomGet);
openapi.get("/agenda/managed-sessions", ManagedSessionsGet);
openapi.put("/agenda/:occurrenceId/invitations", SessionInvitationPut);
openapi.put("/agenda/:occurrenceId/delegation", SessionDelegationPut);
openapi.get("/agenda/:occurrenceId/invitees", SessionInviteesGet);
openapi.get("/agenda/:occurrenceId/management", SessionManagementInfoGet);
openapi.get("/attendance", EventAttendanceGet);
openapi.get("/attendance/summary", AttendanceSummaryGet);
openapi.get("/attendance/attempts", AttendanceAttemptsGet);
openapi.get("/attendance/reasons", AttendanceReasonsGet);
openapi.get("/attendance/people", EventAttendancePeopleGet);
openapi.get("/attendance/people/exports", AttendancePeopleExportGet);
openapi.get("/attendance/attempts/exports", AttendanceAttemptsExportGet);
openapi.get("/attendance/summary/exports", AttendanceSummaryExportGet);
openapi.get("/push/config", EventWebPushConfigurationGet);
openapi.get("/push/devices/:deviceId", EventWebPushStatusGet);
openapi.post("/push/devices", EventWebPushRegisterPost);
openapi.delete("/push/devices/:deviceId", EventWebPushRevokeDelete);
openapi.get("/sponsors/:sponsorId/leads.csv", SponsorLeadsExportGet);
openapi.get("/sponsors/leads", SponsorLeadSponsorsGet);
openapi.get("/sponsors/:sponsorId/leads", SponsorLeadsGet);
openapi.get("/sponsors/:sponsorId/leads/:leadId/captures", SponsorLeadCapturesGet);
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

openapi.get("/attendance/observations", AttendanceEvidenceGet);
openapi.get("/attendance/observations/:observationId/corrections", AttendanceCorrectionHistoryGet);
openapi.post("/attendance/observations/:observationId/corrections", AttendanceCorrectionCreate);
