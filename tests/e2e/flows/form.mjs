/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const FORM_FLOW = {
  id: "form",
  title: "Forms and surveys — define, place, answer, read",
  purpose:
    "Staff define a form once and place it where it is needed; people answer it; the answers are read back against the definition that was live when they answered.",
  personas: ["staff", "respondent"],
  steps: [
    { id: "6.1", title: "Staff manage global forms through the canonical Forms resource", status: "covered" },
    { id: "6.2", title: "Staff filter the forms list and archive or delete a form", status: "covered" },
    {
      id: "6.3",
      title: "Somebody answers a placed form, and a closed window or changed definition is refused",
      status: "covered",
      note: "The browser journey verifies a form closed while the participant is answering, server refusal, preservation of the draft, and the closed notice after reload. Definition-change guards remain covered in group-form-sharing: the answer and the placement it came through, a definition edited between reading and submitting, and both ends of the placement window. The revision is enforced rather than recorded — a trigger refuses a write whose form or placement has moved since it was read, but the submission keeps no revision of its own. So an answer cannot be filed against questions nobody was asked, and equally cannot be read back against the questions as they stood. Worth knowing before anybody reports on an edited survey.",
    },
    {
      id: "6.4",
      title: "An answer is read back against the questions that were asked",
      status: "absent",
      note: "DECIDED: leave it, and accept that a report merges answers from either side of an edit. Nothing stores which revision an answer belongs to, so a report on a form edited mid-collection reads every answer against the current questions. What already holds is the harder half — 6.3's guard refuses an answer landing against a definition that moved while it was being filled in — so the risk left is a reworded question quietly totalled with its earlier self, not an answer filed against a question nobody was asked.",
    },
  ],
};
