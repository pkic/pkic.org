/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const FORM_FLOW = {
  id: "form",
  title: "Forms and surveys — define, place, answer, read",
  purpose:
    "Staff define a form once and place it where it is needed; people answer it; the answers are read back against the definition that was live when they answered.",
  personas: ["staff", "respondent"],
  steps: [
    {
      id: "6.1",
      title: "Staff manage global forms through the canonical Forms resource",
      status: "unit",
      note: "Covered in portal-forms-routes, portal-form-lifecycle and portal-form-management: creation is a page of its own that hands the new key to the form's page, the title edits and saves to the form's own address, and the Worker suite admin-forms-endpoints covers the routes.",
    },
    {
      id: "6.2",
      title: "Staff filter the forms list and archive or delete a form",
      status: "unit",
      note: "Covered in portal-form-management and portal-form-lifecycle: purpose, status and search are server queries, and archive and delete each wait for their confirmation. admin-forms-endpoints covers archiving a form that has responses and deleting an empty one.",
    },
    {
      id: "6.3",
      title: "Somebody answers a placed form, and a closed window or changed definition is refused",
      status: "unit",
      note: "A form closed while the participant is answering is covered in portal-group-form-management (the refusal is announced, the typed answer stays, and a reload states that the form is closed) and in group-form-sharing and form-submission-window on the server. Event registration and proposal answers are explained as event records rather than collected on the form page, in the same component suite. Definition-change guards are covered in group-form-sharing: the answer and the placement it came through, a definition edited between reading and submitting, and both ends of the placement window. The revision is enforced rather than recorded — a trigger refuses a write whose form or placement has moved since it was read, but the submission keeps no revision of its own. So an answer cannot be filed against questions nobody was asked, and equally cannot be read back against the questions as they stood. Worth knowing before anybody reports on an edited survey.",
    },
    {
      id: "6.4",
      title: "An answer is read back against the questions that were asked",
      status: "absent",
      note: "DECIDED: leave it, and accept that a report merges answers from either side of an edit. Nothing stores which revision an answer belongs to, so a report on a form edited mid-collection reads every answer against the current questions. What already holds is the harder half — 6.3's guard refuses an answer landing against a definition that moved while it was being filled in — so the risk left is a reworded question quietly totalled with its earlier self, not an answer filed against a question nobody was asked.",
    },
  ],
};
