/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const PROPOSAL_FLOW = {
  id: "proposal",
  title: "Event proposal — submit, review, decide, live afterwards",
  purpose:
    "Somebody proposes a talk; reviewers score it, the programme decides, and what a proposer may still change depends on that decision.",
  personas: ["proposer", "co-speaker", "reviewer", "programme manager"],
  steps: [
    { id: "4.1", title: "A proposal is reviewed through canonical resources with operator actions", status: "covered" },
    { id: "4.2", title: "A proposer edits the title and abstract while the proposal is open", status: "covered" },
    { id: "4.3", title: "A proposer adds, updates and removes a co-speaker while open", status: "covered" },
    {
      id: "4.4",
      title: "Acceptance freezes the abstract and keeps the speaker roster editable",
      status: "covered",
      note: "The asymmetry is the point: a programme is printed from the abstract, and who actually speaks can still change.",
    },
    { id: "4.5", title: "A rejected proposal closes both its content and its roster", status: "covered" },
    {
      id: "4.6",
      title: "Presentation archives are offered only with proposal read access",
      status: "covered",
    },
    {
      id: "4.7",
      title: "Proposal detail reads canonical proposal resources with no admin fallback",
      status: "covered",
      note: "The same endpoints serve every authorized reader. A fallback that only staff take is a second implementation nobody else exercises.",
    },
  ],
};
