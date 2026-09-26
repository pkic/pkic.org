/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const PROFILE_FLOW = {
  id: "profile",
  title: "Profile — your own record, and what others see of it",
  purpose:
    "A person keeps their own name, likeness and links, decides how much of it appears beside their organization, and reads their own record from a page that offers them different things than it offers anybody looking at them.",
  personas: ["member", "another member", "staff", "freshly approved member"],
  steps: [
    {
      id: "11.1",
      title: "A member edits their name fields and toggles organization-page visibility",
      status: "covered",
    },
    {
      id: "11.2",
      title: "A member uploads a headshot through the disclaimer and crop flow",
      status: "covered",
      note: "The disclaimer is part of the flow, not decoration: a likeness is personal data and the upload says so before it takes one.",
    },
    {
      id: "11.3",
      title: "A member removes their own headshot",
      status: "covered",
    },
    {
      id: "11.4",
      title: "A contact record offers different things on your own page than on somebody else's",
      status: "covered",
      note: "The same route, two readings. Editing affordances follow permission rather than the page you happen to be on.",
    },
    {
      id: "11.5",
      title: "Home shows the organization, the application and a pending review once one exists",
      status: "covered",
      note: "And an individual member with no organization sees an honest empty state rather than a broken card.",
    },
    {
      id: "11.6",
      title: "A freshly approved member sees their application and empty records elsewhere",
      status: "covered",
      note: "The first minute after approval is the one nobody designs for, and the one every new member sees.",
    },
    {
      id: "11.7",
      title: "A person marks which identity their record speaks from",
      status: "absent",
      note: "DECIDED: build it, on the person's own profile — only they know which affiliation represents them, and with identities decoupled from membership more people will hold several. The column, the contract and the About projection exist; a record with none marked falls back to the first active affiliation, which is what it always did. This becomes a gap the moment the setter ships.",
    },
  ],
};
