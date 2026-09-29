/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const PRESENTATION_FLOW = {
  id: "presentation",
  title: "Presentation — the product renders, and stays operable",
  purpose:
    "Not a journey somebody takes, but the conditions every journey depends on: the page fits the screen it is on, the theme reaches all of it, and everything can be reached from a keyboard. Kept as a flow because these fail silently and across every other flow at once.",
  personas: ["anybody", "a keyboard-only reader", "a reader on a phone", "a reader on the dark theme"],
  steps: [
    {
      id: "13.1",
      title: "The dark theme reaches the page itself, and the choice is remembered",
      status: "covered",
      note: "Both halves fail invisibly: a theme that stops at the components leaves white cards under near-white ink, and one that forgets asks the reader to choose again every visit.",
    },
    {
      id: "13.2",
      title: "The design system loads without Bootstrap, without console errors, and sized",
      status: "covered",
      note: "Every fixed-size primitive gets a real size at its default variant — a component that collapses to nothing renders as nothing and passes most other checks.",
    },
    {
      id: "13.3",
      title: "Every interactive control is reachable by keyboard",
      status: "covered",
    },
    {
      id: "13.4",
      title: "The portal is usable at mobile, tablet and desktop",
      status: "covered",
    },
    {
      id: "13.5",
      title: "The portal drawer opens and closes on Escape and on the backdrop, and returns focus",
      status: "covered",
      note: "Returning focus to the toggle is what keeps a keyboard reader from being dropped at the top of the document.",
    },
    {
      id: "13.6",
      title: "The narrow drawer offers the same authorized destinations as the desktop sidebar",
      status: "covered",
      note: "A destination that exists only on desktop is a feature a phone reader does not have.",
    },
    {
      id: "13.7",
      title: "The public site fits the viewport and opens its navigation on a phone",
      status: "covered",
    },
    {
      id: "13.8",
      title: "The portal is composed at every size",
      status: "covered",
    },
  ],
};
