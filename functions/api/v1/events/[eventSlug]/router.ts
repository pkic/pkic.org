import { PromotionKitInitialize, EventPromotionInitialize } from "./agenda/promotion";
import { PromotionBatchesCreate, PromotionBatchGet } from "./agenda/promotion-batches";
import { EventPromotionSessionsGet } from "./agenda/promotion";
import {
  PromotionCompositionSave,
  EventPromotionGet,
  EventPromotionCompositionSave,
  EventPromotionRendersCreate,
  EventPromotionArtifactGet,
} from "./agenda/promotion";
import { registerRecordingRoutes } from "./register-recording-routes";
import { SpeakerProfileReviewsGet, SpeakerProfileApprovalPost } from "./agenda/speaker-profiles";
import { registerScanningRoutes } from "./register-scanning-routes";
import { registerEventManagementAuthentication } from "./register-event-management-authentication";
import { AgendaRoomsOrderPost } from "./agenda/rooms";
import { LocationLiveStreamGet, LocationLiveStreamPut, VirtualRoomGet } from "./agenda/streams";
import { AgendaBreaksPost } from "./agenda/breaks";
import { LiveProgramGet, LiveProgramPost } from "./agenda/live-program";
import { LiveOverlayAccessPost } from "./agenda/live-overlays";
import { LivePollResultsGet } from "./agenda/live-poll-results";
import { AgendaSponsorChoicesGet } from "./agenda/sponsors";
import { registerAgendaReadRoutes } from "./agenda/register-read-routes";
import sessionPresentationsRouter from "./agenda/session-presentations-router";
import {
  AppearanceOverridesGet,
  AppearanceOverrideRequestPost,
  AppearanceOverrideReviewPost,
} from "./agenda/appearance-overrides";
import {
  AgendaTransferExportGet,
  AgendaTransferReviewPost,
  AgendaTransferApplyPost,
  AgendaTransferIdentitiesGet,
} from "./agenda/transfer";
import { SessionRoomRecommendationsGet } from "./room-recommendations";
import { SessionDemandReportGet, SessionDemandReportExportGet } from "./session-demand-report";
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
import { Hono } from "hono";
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
import {
  EventLiveOverlayLayoutDelete,
  EventLiveOverlayLayoutPut,
  EventLiveOverlayLayoutsGet,
  EventLiveOverlayPositionsDelete,
  EventLiveOverlayPositionsPut,
} from "./live-overlay-layouts";
import { EventDaysGet, EventDaysPut } from "./days";
import { EventTeamRosterList, EventTeamRoleCreate, EventTeamRolesList } from "./roles";
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
import { registerAttendanceRoutes } from "./register-attendance-routes";
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
  PersonalAgendaProgramGet,
  SessionVirtualRoomGet,
  SessionParticipationReviewPut,
  SessionBookingsGet,
  SessionHoldPost,
  SessionHoldsGet,
  SessionHoldDelete,
} from "./participation";
import {
  EventBadgeCreate,
  EventBadgeCurrentPut,
  EventBadgeDelete,
  EventBadgeAttendeesGet,
  EventBadgesGet,
  EventBadgeGet,
  EventBadgePrint,
  EventBadgePrintingGet,
} from "./badges";
import {
  AgendaCalendarRotatePost,
  AgendaCalendarCurrentGet,
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
import emailRouter from "./email/router";
import proposals_Router from "./proposals/router";
import registrations_Router from "./registrations/router";
import eventForms_Router from "./forms/[formKey]/router";
import type { RequestDbContext } from "../../../../_lib/db/context";
import { publicReadRoute } from "../../../../_lib/cache/public-read";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

// The resolved active placement is intentionally public and must be mounted
// before the authenticated event-form management subtree.
openapi.get("/forms/placements/:purpose", EventFormPlacementGet);

registerEventManagementAuthentication(app);

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
openapi.get("/team", EventTeamRosterList);
openapi.get("/roles", EventTeamRolesList);
openapi.post("/roles", EventTeamRoleCreate);
openapi.delete("/roles/:roleAssignmentId", EventTeamRoleDelete);
openapi.get("/promoters", EventPromotersList);
openapi.get("/presentations/archive", EventPresentationArchiveGet);
openapi.get("/analytics", EventAnalyticsGet);
registerRecordingRoutes(openapi);
registerAgendaReadRoutes(openapi);
openapi.post("/agenda/settings", AgendaSettingsPost);
openapi.get("/agenda/occurrences/:occurrenceId/room-recommendations", SessionRoomRecommendationsGet);
openapi.get("/agenda/reports/demand", SessionDemandReportGet);
openapi.get("/agenda/reports/demand/exports", SessionDemandReportExportGet);
openapi.post("/agenda/rooms", AgendaRoomCreate);
openapi.post("/agenda/rooms/order", AgendaRoomsOrderPost);
openapi.put("/agenda/rooms/:roomId", AgendaRoomUpdate);
openapi.get("/agenda/rooms/:roomId/stream", LocationLiveStreamGet);
openapi.put("/agenda/rooms/:roomId/stream", LocationLiveStreamPut);
openapi.get("/agenda/streams", VirtualRoomGet);
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
openapi.get("/speakers/profiles", SpeakerProfileReviewsGet);
openapi.post("/speakers/profiles/reviews", SpeakerProfileApprovalPost);
registerScanningRoutes(openapi);
openapi.get("/calendar/settings", AgendaCalendarSettingsGet);
openapi.put("/calendar/settings", AgendaCalendarSettingsPut);
openapi.post("/calendar/subscriptions", AgendaCalendarRotatePost);
openapi.delete("/calendar/subscriptions", AgendaCalendarRevokeDelete);
openapi.get("/calendar/subscriptions/current", AgendaCalendarCurrentGet);
openapi.get("/calendar/subscriptions/:token/calendar.ics", AgendaCalendarFeedGet);
openapi.post("/promotion/batches", PromotionBatchesCreate);
openapi.get("/promotion/batches/:batchId", PromotionBatchGet);
openapi.get("/promotion", EventPromotionGet);
openapi.post("/promotion/referrals", EventPromotionInitialize);
openapi.get("/promotion/sessions", EventPromotionSessionsGet);
openapi.post("/promotion/composition", EventPromotionCompositionSave);
openapi.post("/promotion/renders", EventPromotionRendersCreate);
openapi.get("/promotion/artifact", EventPromotionArtifactGet);
openapi.post("/agenda/occurrences/:occurrenceId/promotion/composition", PromotionCompositionSave);
openapi.get("/agenda/promotion", PromotionSessionsGet);
openapi.get("/agenda/occurrences/:occurrenceId/promotion", PromotionKitGet);
openapi.post("/agenda/occurrences/:occurrenceId/promotion/referrals", PromotionKitInitialize);
openapi.post("/agenda/occurrences/:occurrenceId/promotion", PromotionCopySave);
openapi.post("/agenda/occurrences/:occurrenceId/promotion/renders", PromotionRendersCreate);
openapi.get("/agenda/occurrences/:occurrenceId/promotion/artifact", PromotionArtifactGet);
openapi.get("/agenda/contents", AgendaContentsGet);
openapi.post("/agenda/contents", AgendaContentCreate);
openapi.post("/agenda/contents/copy", AgendaContentCopy);
openapi.patch("/agenda/contents/:contentId", AgendaContentPatch);
openapi.post("/agenda/contents/:contentId/placements", AgendaContentPlace);
openapi.post("/agenda/occurrences/:occurrenceId/placements", AgendaOccurrencePlace);
openapi.post("/agenda/occurrences/:occurrenceId/holds", SessionHoldPost);
openapi.get("/agenda/occurrences/:occurrenceId/holds", SessionHoldsGet);
openapi.delete("/agenda/occurrences/:occurrenceId/holds/:holdId", SessionHoldDelete);
openapi.get("/badges/attendees", EventBadgeAttendeesGet);
openapi.get("/badges", EventBadgesGet);
openapi.get("/badges/printing", EventBadgePrintingGet);
openapi.put("/badges/current", EventBadgeCurrentPut);
openapi.get("/badges/:badgeId", EventBadgeGet);
openapi.post("/badges", EventBadgeCreate);
openapi.delete("/badges/:badgeId", EventBadgeDelete);
openapi.post("/badges/:badgeId/print", EventBadgePrint);
openapi.get("/agenda/occurrences/:occurrenceId/participation", SessionBookingsGet);
openapi.get("/agenda/occurrences/:occurrenceId/attendance", SessionAttendancePeopleGet);
openapi.put("/agenda/occurrences/:occurrenceId/participation", SessionParticipationPut);
openapi.put("/agenda/occurrences/:occurrenceId/participation/:userId", SessionParticipationReviewPut);
openapi.get("/agenda/participation", PersonalAgendaGet);
openapi.get("/agenda/participation/program", PersonalAgendaProgramGet);
openapi.get("/agenda/occurrences/:occurrenceId/virtual-room", SessionVirtualRoomGet);
// The room's socket itself (GET …/live with Upgrade: websocket) is dispatched before this router; see live-session-socket.
openapi.post("/agenda/rooms/:roomId/live/overlays", LiveOverlayAccessPost);
openapi.get("/agenda/rooms/:roomId/live/program", LiveProgramGet);
openapi.post("/agenda/rooms/:roomId/live/program", LiveProgramPost);
openapi.get("/agenda/occurrences/:occurrenceId/live/polls", LivePollResultsGet);
openapi.get("/agenda/managed-sessions", ManagedSessionsGet);
openapi.put("/agenda/occurrences/:occurrenceId/invitations", SessionInvitationPut);
openapi.put("/agenda/occurrences/:occurrenceId/delegation", SessionDelegationPut);
openapi.get("/agenda/occurrences/:occurrenceId/invitees", SessionInviteesGet);
openapi.get("/agenda/occurrences/:occurrenceId/management", SessionManagementInfoGet);
openapi.get("/attendance", EventAttendanceGet);
registerAttendanceRoutes(openapi);
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
openapi.get("/settings/live/layouts", EventLiveOverlayLayoutsGet);
openapi.put("/settings/live/layouts/:layoutSlug", EventLiveOverlayLayoutPut);
openapi.delete("/settings/live/layouts/:layoutSlug", EventLiveOverlayLayoutDelete);
openapi.put("/settings/live/positions", EventLiveOverlayPositionsPut);
openapi.delete("/settings/live/positions", EventLiveOverlayPositionsDelete);
openapi.get("/", publicReadRoute(EventDetailGet));
app.all("/registrations", () => methodNotAllowed(["GET", "POST"]));

export default openapi;
