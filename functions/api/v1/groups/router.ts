import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { GroupsCreate, GroupsList } from "./index";
import { GroupGet, GroupUpdate } from "./[groupId]";
import { GroupPortalContextGet } from "./[groupId]/context";
import { GroupDirectoryGet } from "./[groupId]/directory";
import { GroupTypesList } from "./types";
import { GroupCreationCapabilitiesGet } from "./creation-capabilities";
import { GroupJoin } from "./[groupId]/join";
import { GroupLeave } from "./[groupId]/leave";
import { GroupMembershipsList, GroupMemberAdd } from "./[groupId]/memberships/index";
import { GroupMembershipEnd } from "./[groupId]/memberships/[membershipId]";
import { GroupLeadershipAssign, GroupLeadershipList } from "./[groupId]/leadership/index";
import { GroupLeadershipRevoke } from "./[groupId]/leadership/[userRoleId]";
import { GroupCategoryRulesReplace } from "./[groupId]/category-rules";
import { GroupCategoryRulesGet } from "./[groupId]/category-rules-get";
import { GroupMailingListCreate, GroupMailingListSubscriptions } from "./[groupId]/mailing-lists/index";
import {
  GroupMailingListArchive,
  GroupMailingListPreferenceUpdate,
  GroupMailingListUpdate,
} from "./[groupId]/mailing-lists/[listId]";
import { GroupMailingListManagementList } from "./[groupId]/mailing-lists/management";
import { GroupAutomaticEnrollmentPreference } from "./[groupId]/automatic-enrollment";
import { GroupMeetingSeriesCreate, GroupMeetingSeriesList } from "./[groupId]/meetings/series/index";
import { GroupMeetingSeriesUpdate } from "./[groupId]/meetings/series/[seriesId]/index";
import { GroupMeetingSeriesCalendar } from "./[groupId]/meetings/series/[seriesId]/calendar";
import { GroupMeetingSeriesMaterialize } from "./[groupId]/meetings/series/[seriesId]/materialize";
import {
  GroupMeetingOccurrenceCreate,
  GroupMeetingOccurrencesList,
} from "./[groupId]/meetings/series/[seriesId]/occurrences/index";
import { GroupMeetingOccurrenceUpdate } from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/index";
import {
  GroupMeetingGuestInvite,
  GroupMeetingGuestsList,
} from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/guests/index";
import { GroupMeetingGuestRevoke } from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/guests/[guestId]";
import { GroupMeetingAttendanceList } from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/attendance/index";
import { GroupMeetingAttendanceVerify } from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/attendance/[confirmationId]";
import {
  eventGrantRoutes,
  formPlacementGrantRoutes,
  mailingListGrantRoutes,
  voteGrantRoutes,
} from "./resource-grant-handlers";
import { GroupFormCreate, GroupFormsList } from "./[groupId]/forms/index";
import {
  GroupFormDefinitionGet,
  GroupFormDefinitionUpdate,
  GroupFormPlacementUpdate,
} from "./[groupId]/forms/[placementId]";
import { GroupFormSubmissionCreate, GroupFormSubmissionsList } from "./[groupId]/forms/[placementId]/submissions";
import { GroupFormSubmissionStats } from "./[groupId]/forms/[placementId]/submission-stats";
import { GroupEventsCreate, GroupEventsList } from "./[groupId]/events/index";
import { GroupEventProfilesList } from "./[groupId]/events/profiles";
import { GroupEventDetailGet, GroupEventSettingsPatch } from "./[groupId]/events/[eventId]";
import { GroupEventProposalsList } from "./[groupId]/events/[eventId]/proposals";
import {
  GroupEventProposalDetailGet,
  GroupEventProposalPatch,
} from "./[groupId]/events/[eventId]/proposals/[proposalId]";
import {
  GroupEventProposalReviewsList,
  GroupEventProposalReviewUpsert,
} from "./[groupId]/events/[eventId]/proposals/[proposalId]/reviews";
import { GroupEventProposalReviewPatch } from "./[groupId]/events/[eventId]/proposals/[proposalId]/reviews/[reviewId]";
import {
  GroupEventProposalCommentsList,
  GroupEventProposalCommentCreate,
} from "./[groupId]/events/[eventId]/proposals/[proposalId]/comments";
import { GroupEventProposalCancel } from "./[groupId]/events/[eventId]/proposals/[proposalId]/cancel";
import { GroupEventProposalFinalizePreview } from "./[groupId]/events/[eventId]/proposals/[proposalId]/finalize-preview";
import { GroupEventProposalFinalize } from "./[groupId]/events/[eventId]/proposals/[proposalId]/finalize";
import { GroupEventProposalAuditLogList } from "./[groupId]/events/[eventId]/proposals/[proposalId]/audit-log";
import {
  GroupEventProposalSpeakerInvitePost,
  GroupEventProposalSpeakersGet,
} from "./[groupId]/events/[eventId]/proposals/[proposalId]/speakers";
import {
  GroupEventProposalSpeakerDelete,
  GroupEventProposalSpeakerPatch,
} from "./[groupId]/events/[eventId]/proposals/[proposalId]/speakers/[userId]";
import {
  GroupEventProposalRemindPresentationPost,
  GroupEventProposalRemindSpeakersPost,
  GroupEventProposalSpeakerRemindPost,
  GroupEventProposalSpeakerRemindPresentationPost,
} from "./[groupId]/events/[eventId]/proposals/[proposalId]/speakers/reminders";
import {
  GroupEventProposalSpeakerHeadshotDelete,
  GroupEventProposalSpeakerHeadshotGet,
  GroupEventProposalSpeakerHeadshotPut,
} from "./[groupId]/events/[eventId]/proposals/[proposalId]/speakers/headshot";
import { GroupEventProposalSpeakerGravatarPost } from "./[groupId]/events/[eventId]/proposals/[proposalId]/speakers/gravatar";
import {
  GroupEventRegistrationAdmitPost,
  GroupEventRegistrationCreate,
  GroupEventRegistrationDayAttendancePatch,
  GroupEventRegistrationDetailGet,
  GroupEventRegistrationsList,
} from "./[groupId]/events/[eventId]/registrations";
import { GroupEventRegistrationConfigGet } from "./[groupId]/events/[eventId]/registration-config";
import { GroupEventDaysGet, GroupEventDaysPut } from "./[groupId]/events/[eventId]/days";
import { GroupEventTermsGet, GroupEventTermsPut } from "./[groupId]/events/[eventId]/terms";
import {
  GroupEventRegistrationSettingsGet,
  GroupEventRegistrationSettingsPut,
} from "./[groupId]/events/[eventId]/registration-settings";
import {
  GroupEventFormCreate,
  GroupEventFormGet,
  GroupEventFormPut,
  GroupEventFormsList,
} from "./[groupId]/events/[eventId]/forms";
import { registerGroupEventInviteRoutes } from "./register-group-event-invite-routes";
import { GroupAuditLogList } from "./[groupId]/audit-log";
import { GroupStatsGet } from "./[groupId]/stats";
import { GroupUserCatalogList } from "./[groupId]/user-catalog";
import { GroupVotesList } from "./[groupId]/votes/index";
import { GroupVoteGet } from "./[groupId]/votes/[voteId]/index";
import { GroupVoteBallotsPost } from "./[groupId]/votes/[voteId]/ballots";
import { GroupVoteResultsGet } from "./[groupId]/votes/[voteId]/results";
import { GroupVoteCreate } from "./[groupId]/votes/create";
import { GroupVoteSettingsPatch } from "./[groupId]/votes/[voteId]/settings";
import { GroupVoteVisibilityPatch } from "./[groupId]/votes/[voteId]/visibility";
import { GroupVoteBallotAuditGet } from "./[groupId]/votes/[voteId]/ballot-audit";
import { GroupVoteStatisticsGet } from "./[groupId]/votes/[voteId]/statistics";
import { GroupVoteTransitionPost } from "./[groupId]/votes/[voteId]/transitions";
import { GroupVoteProposalCreate, GroupVoteProposalsList } from "./[groupId]/vote-proposals/index";
import { GroupVoteProposalDelete, GroupVoteProposalGet } from "./[groupId]/vote-proposals/[proposalId]/index";
import {
  GroupVoteProposalEndorseDelete,
  GroupVoteProposalEndorsePost,
} from "./[groupId]/vote-proposals/[proposalId]/endorsement";
import { GroupVoteProposalApprovePost } from "./[groupId]/vote-proposals/[proposalId]/approve";
import { GroupVoteProposalRejectPost } from "./[groupId]/vote-proposals/[proposalId]/reject";

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/types", GroupTypesList);
openapi.get("/creation-capabilities", GroupCreationCapabilitiesGet);
openapi.get("/", GroupsList);
openapi.post("/", GroupsCreate);
openapi.get("/:groupId", GroupGet);
openapi.get("/:groupId/context", GroupPortalContextGet);
openapi.get("/:groupId/directory", GroupDirectoryGet);
openapi.patch("/:groupId", GroupUpdate);
openapi.post("/:groupId/join", GroupJoin);
openapi.post("/:groupId/leave", GroupLeave);
openapi.get("/:groupId/memberships", GroupMembershipsList);
openapi.post("/:groupId/memberships/:userId", GroupMemberAdd);
openapi.delete("/:groupId/memberships/:membershipId", GroupMembershipEnd);
openapi.get("/:groupId/leadership", GroupLeadershipList);
openapi.post("/:groupId/leadership", GroupLeadershipAssign);
openapi.delete("/:groupId/leadership/:userRoleId", GroupLeadershipRevoke);
openapi.put("/:groupId/category-rules", GroupCategoryRulesReplace);
openapi.get("/:groupId/category-rules", GroupCategoryRulesGet);
openapi.get("/:groupId/mailing-lists", GroupMailingListSubscriptions);
openapi.get("/:groupId/mailing-lists/management", GroupMailingListManagementList);
openapi.post("/:groupId/mailing-lists", GroupMailingListCreate);
openapi.put("/:groupId/mailing-lists/:listId/subscription", GroupMailingListPreferenceUpdate);
openapi.patch("/:groupId/mailing-lists/:listId", GroupMailingListUpdate);
openapi.delete("/:groupId/mailing-lists/:listId", GroupMailingListArchive);
openapi.put("/:groupId/automatic-enrollment", GroupAutomaticEnrollmentPreference);
openapi.get("/:groupId/audit-log", GroupAuditLogList);
openapi.get("/:groupId/stats", GroupStatsGet);
openapi.get("/:groupId/user-catalog", GroupUserCatalogList);
openapi.get("/:groupId/forms", GroupFormsList);
openapi.post("/:groupId/forms", GroupFormCreate);
openapi.get("/:groupId/forms/:placementId", GroupFormDefinitionGet);
openapi.patch("/:groupId/forms/:placementId", GroupFormPlacementUpdate);
openapi.patch("/:groupId/forms/:placementId/definition", GroupFormDefinitionUpdate);
openapi.get("/:groupId/forms/:placementId/submissions", GroupFormSubmissionsList);
openapi.post("/:groupId/forms/:placementId/submissions", GroupFormSubmissionCreate);
openapi.get("/:groupId/forms/:placementId/submissions/stats", GroupFormSubmissionStats);
openapi.get("/:groupId/events", GroupEventsList);
openapi.post("/:groupId/events", GroupEventsCreate);
openapi.get("/:groupId/events/profiles", GroupEventProfilesList);
openapi.get("/:groupId/events/:eventId", GroupEventDetailGet);
openapi.patch("/:groupId/events/:eventId/settings", GroupEventSettingsPatch);
openapi.get("/:groupId/events/:eventId/proposals", GroupEventProposalsList);
openapi.get("/:groupId/events/:eventId/proposals/:proposalId", GroupEventProposalDetailGet);
openapi.patch("/:groupId/events/:eventId/proposals/:proposalId", GroupEventProposalPatch);
openapi.post("/:groupId/events/:eventId/proposals/:proposalId/cancel", GroupEventProposalCancel);
openapi.post("/:groupId/events/:eventId/proposals/:proposalId/finalize-preview", GroupEventProposalFinalizePreview);
openapi.post("/:groupId/events/:eventId/proposals/:proposalId/finalize", GroupEventProposalFinalize);
openapi.get("/:groupId/events/:eventId/proposals/:proposalId/audit-log", GroupEventProposalAuditLogList);
openapi.get("/:groupId/events/:eventId/proposals/:proposalId/speakers", GroupEventProposalSpeakersGet);
openapi.post("/:groupId/events/:eventId/proposals/:proposalId/speakers", GroupEventProposalSpeakerInvitePost);
openapi.patch("/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId", GroupEventProposalSpeakerPatch);
openapi.delete("/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId", GroupEventProposalSpeakerDelete);
openapi.post(
  "/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId/remind",
  GroupEventProposalSpeakerRemindPost,
);
openapi.post(
  "/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId/remind-presentation",
  GroupEventProposalSpeakerRemindPresentationPost,
);
openapi.get(
  "/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId/headshot",
  GroupEventProposalSpeakerHeadshotGet,
);
openapi.put(
  "/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId/headshot",
  GroupEventProposalSpeakerHeadshotPut,
);
openapi.delete(
  "/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId/headshot",
  GroupEventProposalSpeakerHeadshotDelete,
);
openapi.post(
  "/:groupId/events/:eventId/proposals/:proposalId/speakers/:userId/gravatar",
  GroupEventProposalSpeakerGravatarPost,
);
openapi.post("/:groupId/events/:eventId/proposals/:proposalId/remind-speakers", GroupEventProposalRemindSpeakersPost);
openapi.post(
  "/:groupId/events/:eventId/proposals/:proposalId/remind-presentation",
  GroupEventProposalRemindPresentationPost,
);
openapi.get("/:groupId/events/:eventId/proposals/:proposalId/reviews", GroupEventProposalReviewsList);
openapi.post("/:groupId/events/:eventId/proposals/:proposalId/reviews", GroupEventProposalReviewUpsert);
openapi.patch("/:groupId/events/:eventId/proposals/:proposalId/reviews/:reviewId", GroupEventProposalReviewPatch);
openapi.get("/:groupId/events/:eventId/proposals/:proposalId/comments", GroupEventProposalCommentsList);
openapi.post("/:groupId/events/:eventId/proposals/:proposalId/comments", GroupEventProposalCommentCreate);
openapi.get("/:groupId/events/:eventId/registrations", GroupEventRegistrationsList);
openapi.get("/:groupId/events/:eventId/registrations/:registrationId", GroupEventRegistrationDetailGet);
openapi.patch(
  "/:groupId/events/:eventId/registrations/:registrationId/day-attendance",
  GroupEventRegistrationDayAttendancePatch,
);
openapi.post("/:groupId/events/:eventId/registrations/:registrationId/admit", GroupEventRegistrationAdmitPost);
openapi.get("/:groupId/events/:eventId/registration-config", GroupEventRegistrationConfigGet);
openapi.get("/:groupId/events/:eventId/days", GroupEventDaysGet);
openapi.put("/:groupId/events/:eventId/days", GroupEventDaysPut);
openapi.get("/:groupId/events/:eventId/terms", GroupEventTermsGet);
openapi.put("/:groupId/events/:eventId/terms", GroupEventTermsPut);
openapi.get("/:groupId/events/:eventId/registration-settings", GroupEventRegistrationSettingsGet);
openapi.put("/:groupId/events/:eventId/registration-settings", GroupEventRegistrationSettingsPut);
openapi.get("/:groupId/events/:eventId/forms/:purpose/available", GroupEventFormsList);
openapi.get("/:groupId/events/:eventId/forms/:purpose", GroupEventFormGet);
openapi.put("/:groupId/events/:eventId/forms/:purpose", GroupEventFormPut);
openapi.post("/:groupId/events/:eventId/forms/:purpose", GroupEventFormCreate);
openapi.get("/:groupId/votes", GroupVotesList);
openapi.post("/:groupId/votes", GroupVoteCreate);
openapi.get("/:groupId/votes/:voteId", GroupVoteGet);
openapi.patch("/:groupId/votes/:voteId", GroupVoteSettingsPatch);
openapi.patch("/:groupId/votes/:voteId/visibility", GroupVoteVisibilityPatch);
openapi.get("/:groupId/votes/:voteId/ballots", GroupVoteBallotAuditGet);
openapi.post("/:groupId/votes/:voteId/ballots", GroupVoteBallotsPost);
openapi.get("/:groupId/votes/:voteId/results", GroupVoteResultsGet);
openapi.get("/:groupId/votes/:voteId/statistics", GroupVoteStatisticsGet);
openapi.post("/:groupId/votes/:voteId/transitions", GroupVoteTransitionPost);
openapi.get("/:groupId/vote-proposals", GroupVoteProposalsList);
openapi.post("/:groupId/vote-proposals", GroupVoteProposalCreate);
openapi.get("/:groupId/vote-proposals/:proposalId", GroupVoteProposalGet);
openapi.delete("/:groupId/vote-proposals/:proposalId", GroupVoteProposalDelete);
openapi.post("/:groupId/vote-proposals/:proposalId/endorsement", GroupVoteProposalEndorsePost);
openapi.delete("/:groupId/vote-proposals/:proposalId/endorsement", GroupVoteProposalEndorseDelete);
openapi.post("/:groupId/vote-proposals/:proposalId/approve", GroupVoteProposalApprovePost);
openapi.post("/:groupId/vote-proposals/:proposalId/reject", GroupVoteProposalRejectPost);
openapi.post("/:groupId/events/:eventId/registrations", GroupEventRegistrationCreate);
registerGroupEventInviteRoutes(openapi);
openapi.get("/:groupId/meetings/series", GroupMeetingSeriesList);
openapi.post("/:groupId/meetings/series", GroupMeetingSeriesCreate);
openapi.patch("/:groupId/meetings/series/:seriesId", GroupMeetingSeriesUpdate);
openapi.get("/:groupId/meetings/series/:seriesId/calendar.ics", GroupMeetingSeriesCalendar);
openapi.post("/:groupId/meetings/series/:seriesId/materialize", GroupMeetingSeriesMaterialize);
openapi.get("/:groupId/meetings/series/:seriesId/occurrences", GroupMeetingOccurrencesList);
openapi.post("/:groupId/meetings/series/:seriesId/occurrences", GroupMeetingOccurrenceCreate);
openapi.patch("/:groupId/meetings/series/:seriesId/occurrences/:occurrenceId", GroupMeetingOccurrenceUpdate);
openapi.get("/:groupId/meetings/series/:seriesId/occurrences/:occurrenceId/guests", GroupMeetingGuestsList);
openapi.post("/:groupId/meetings/series/:seriesId/occurrences/:occurrenceId/guests", GroupMeetingGuestInvite);
openapi.delete(
  "/:groupId/meetings/series/:seriesId/occurrences/:occurrenceId/guests/:guestId",
  GroupMeetingGuestRevoke,
);
openapi.get("/:groupId/meetings/series/:seriesId/occurrences/:occurrenceId/attendance", GroupMeetingAttendanceList);
openapi.put(
  "/:groupId/meetings/series/:seriesId/occurrences/:occurrenceId/attendance/:confirmationId",
  GroupMeetingAttendanceVerify,
);
openapi.get("/:groupId/forms/:placementId/grants", formPlacementGrantRoutes.list);
openapi.post("/:groupId/forms/:placementId/grants", formPlacementGrantRoutes.create);
openapi.delete("/:groupId/forms/:placementId/grants/:granteeGroupId/:capability", formPlacementGrantRoutes.revoke);
openapi.get("/:groupId/events/:eventId/grants", eventGrantRoutes.list);
openapi.post("/:groupId/events/:eventId/grants", eventGrantRoutes.create);
openapi.delete("/:groupId/events/:eventId/grants/:granteeGroupId/:capability", eventGrantRoutes.revoke);
openapi.get("/:groupId/votes/:voteId/grants", voteGrantRoutes.list);
openapi.post("/:groupId/votes/:voteId/grants", voteGrantRoutes.create);
openapi.delete("/:groupId/votes/:voteId/grants/:granteeGroupId/:capability", voteGrantRoutes.revoke);
openapi.get("/:groupId/mailing-lists/:listId/grants", mailingListGrantRoutes.list);
openapi.post("/:groupId/mailing-lists/:listId/grants", mailingListGrantRoutes.create);
openapi.delete("/:groupId/mailing-lists/:listId/grants/:granteeGroupId/:capability", mailingListGrantRoutes.revoke);

export default openapi;
