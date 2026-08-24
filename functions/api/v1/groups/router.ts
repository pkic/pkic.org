import { Hono } from "hono";
import { fromHono } from "chanfana";
import type { RequestDbContext } from "../../../_lib/db/context";
import { GroupsCreate, GroupsList } from "./index";
import { GroupGet, GroupUpdate } from "./[groupId]";
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

const app = new Hono<RequestDbContext>();
export const openapi = fromHono(app);

openapi.get("/types", GroupTypesList);
openapi.get("/", GroupsList);
openapi.post("/", GroupsCreate);
openapi.get("/:groupId", GroupGet);
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
openapi.get("/:groupId/meetings/series", GroupMeetingSeriesList);
openapi.post("/:groupId/meetings/series", GroupMeetingSeriesCreate);
openapi.patch("/:groupId/meetings/series/:seriesId", GroupMeetingSeriesUpdate);
openapi.get("/:groupId/meetings/series/:seriesId/calendar.ics", GroupMeetingSeriesCalendar);
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

export default openapi;
