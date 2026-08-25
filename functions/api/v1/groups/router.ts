import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { GroupsCreate, GroupsList } from "./index";
import { GroupGet, GroupUpdate } from "./[groupId]";
import { GroupPortalContextGet } from "./[groupId]/context";
import { GroupTypesList } from "./types";
import { GroupJoin } from "./[groupId]/join";
import { GroupLeave } from "./[groupId]/leave";
import { GroupMembershipsList, GroupMemberAdd } from "./[groupId]/memberships/index";
import { GroupMembershipEnd } from "./[groupId]/memberships/[membershipId]";
import { GroupLeadershipAssign, GroupLeadershipList } from "./[groupId]/leadership/index";
import { GroupLeadershipRevoke } from "./[groupId]/leadership/[userRoleId]";
import { GroupCategoryRulesReplace } from "./[groupId]/category-rules";
import { GroupMailingListSubscriptions } from "./[groupId]/mailing-lists/index";
import { GroupMailingListPreferenceUpdate } from "./[groupId]/mailing-lists/[listId]";
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
import { GroupMeetingAccessIssue } from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/access";
import { GroupMeetingAttendanceList } from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/attendance/index";
import { GroupMeetingAttendanceVerify } from "./[groupId]/meetings/series/[seriesId]/occurrences/[occurrenceId]/attendance/[confirmationId]";
import {
  eventGrantRoutes,
  formPlacementGrantRoutes,
  mailingListGrantRoutes,
  voteGrantRoutes,
} from "./resource-grant-handlers";
import { GroupFormsList } from "./[groupId]/forms/index";
import { GroupFormDefinitionGet, GroupFormPlacementUpdate } from "./[groupId]/forms/[placementId]";
import { GroupFormSubmissionCreate, GroupFormSubmissionsList } from "./[groupId]/forms/[placementId]/submissions";
import { GroupFormSubmissionStats } from "./[groupId]/forms/[placementId]/submission-stats";
import { GroupEventsList } from "./[groupId]/events/index";
import { GroupEventDetailGet } from "./[groupId]/events/[eventId]";
import { GroupEventRegistrationCreate } from "./[groupId]/events/[eventId]/registrations";
import { GroupAuditLogList } from "./[groupId]/audit-log";
import { GroupVotesList } from "./[groupId]/votes/index";
import { GroupVoteGet } from "./[groupId]/votes/[voteId]/index";
import { GroupVoteBallotsPost } from "./[groupId]/votes/[voteId]/ballots";
import { GroupVoteResultsGet } from "./[groupId]/votes/[voteId]/results";
import { GroupVoteCreate } from "./[groupId]/votes/create";
import { GroupVoteSettingsPatch } from "./[groupId]/votes/[voteId]/settings";
import { GroupVoteVisibilityPatch } from "./[groupId]/votes/[voteId]/visibility";
import { GroupVoteBallotAuditGet } from "./[groupId]/votes/[voteId]/ballot-audit";
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
openapi.get("/", GroupsList);
openapi.post("/", GroupsCreate);
openapi.get("/:groupId", GroupGet);
openapi.get("/:groupId/context", GroupPortalContextGet);
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
openapi.get("/:groupId/mailing-lists", GroupMailingListSubscriptions);
openapi.put("/:groupId/mailing-lists/:listId/subscription", GroupMailingListPreferenceUpdate);
openapi.put("/:groupId/automatic-enrollment", GroupAutomaticEnrollmentPreference);
openapi.get("/:groupId/audit-log", GroupAuditLogList);
openapi.get("/:groupId/forms", GroupFormsList);
openapi.get("/:groupId/forms/:placementId", GroupFormDefinitionGet);
openapi.patch("/:groupId/forms/:placementId", GroupFormPlacementUpdate);
openapi.get("/:groupId/forms/:placementId/submissions", GroupFormSubmissionsList);
openapi.post("/:groupId/forms/:placementId/submissions", GroupFormSubmissionCreate);
openapi.get("/:groupId/forms/:placementId/submissions/stats", GroupFormSubmissionStats);
openapi.get("/:groupId/events", GroupEventsList);
openapi.get("/:groupId/events/:eventId", GroupEventDetailGet);
openapi.get("/:groupId/votes", GroupVotesList);
openapi.post("/:groupId/votes", GroupVoteCreate);
openapi.get("/:groupId/votes/:voteId", GroupVoteGet);
openapi.patch("/:groupId/votes/:voteId", GroupVoteSettingsPatch);
openapi.patch("/:groupId/votes/:voteId/visibility", GroupVoteVisibilityPatch);
openapi.get("/:groupId/votes/:voteId/ballots", GroupVoteBallotAuditGet);
openapi.post("/:groupId/votes/:voteId/ballots", GroupVoteBallotsPost);
openapi.get("/:groupId/votes/:voteId/results", GroupVoteResultsGet);
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
openapi.post("/:groupId/meetings/series/:seriesId/occurrences/:occurrenceId/access", GroupMeetingAccessIssue);
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
