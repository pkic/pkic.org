/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const GROUPS_FLOW = {
  id: "groups",
  title: "Groups — the catalog, joining, and the workspace",
  purpose:
    "A group is where the consortium's work happens. People find one, join it in the capacity they hold, and its managers run its roster, its mailing list and its meetings from one workspace whose tabs appear only where the reader may use them.",
  personas: ["member", "member representing two organizations", "group manager", "staff", "participant"],
  steps: [
    {
      id: "8.1",
      title: "Search, sort and filter the catalog, then open a group",
      status: "covered",
    },
    {
      id: "8.2",
      title: "Create a group, landing on its Settings; a member without the permission is redirected",
      status: "covered",
      note: "The redirect is the assertion worth having: a create page reachable by URL is a create page somebody will reach.",
    },
    {
      id: "8.3",
      title: "Join through the participation card, then remove that capacity",
      status: "covered",
      note: "Removing asks for confirmation, because leaving is not the same kind of act as joining.",
    },
    {
      id: "8.4",
      title: "Join selectively for one of two represented organizations, then leave all at once",
      status: "covered",
      note: "Participation is per capacity, so somebody may sit in a group for one Member and not the other.",
    },
    {
      id: "8.5",
      title: "A manager adds a person and ends their seat through the Members tab",
      status: "covered",
      note: "Ended, not deleted: the seat stays as the group's history, and the database refuses a hard delete outright.",
    },
    {
      id: "8.6",
      title: "A participant sees the roster read-only, with no management affordances",
      status: "covered",
      note: "Not merely disabled controls — absent ones. A disabled button still tells a participant the action exists.",
    },
    {
      id: "8.7",
      title: "A tab the reader may not reach shows the permission-denied fallback",
      status: "covered",
    },
    {
      id: "8.8",
      title: "Staff run a governing body's roster, and its published directory follows",
      status: "covered",
      note: "The Board of Directors is the case where visibility and publication diverge: you cannot browse to the group, and who sits on it is a matter of public record.",
    },
    {
      id: "8.9",
      title: "A manager creates, edits and archives a mailing list",
      status: "covered",
      note: "Archived rather than deleted, so an address that carried discussion keeps its history.",
    },
    {
      id: "8.10",
      title: "A member joins an open group, sets a mail preference, and leaves again",
      status: "covered",
    },
    {
      id: "8.12",
      title: "A published leader renders even when their links are incomplete",
      status: "gap",
      note: "dev-pkic.org#25. The current-leadership query inner-joins a live group membership, an active member, an active identity and a member capacity, so a leader missing any one of them does not render as a card — reported as a representative having to be active and tied to an organization before a board would show them properly. The past-leadership query LEFT JOINs the same links and tolerates it. Which of the two is right is a decision about what a governance roster publishes, not a bug to loosen in passing: relaxing the joins publishes people the stricter query deliberately withheld.",
    },
    {
      id: "8.13",
      title: "Assigning a chair offers matching people as you type",
      status: "gap",
      note: "dev-pkic.org#26. The picker asks for a name, then a search, then a selection, where it used to suggest as you typed. A regression in interaction rather than in behaviour, and the board-member picker is the shape to match.",
    },
    {
      id: "8.11",
      title: "Attendance counts only the meetings a seat was open for",
      status: "unit",
      note: "Covered in user-participation: meetings before the join date, meetings not yet held, cancelled meetings and another group's meetings are all excluded, and a group somebody has left drops out entirely. Worth knowing how that last one holds — the query bounds occurrences below by the join date and not above by the leaving date, and is correct only because the surface reports live seats alone. The first surface to report a former seat's attendance inherits a count that runs to today, and the roster already offers a Former filter.",
    },
  ],
};
