/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const PROPOSAL_FLOW = {
  id: "proposal",
  title: "Event proposal — submit, review, decide, live afterwards",
  purpose:
    "Somebody proposes a talk; reviewers score it, the programme decides, and what a proposer may still change depends on that decision.",
  personas: ["proposer", "co-speaker", "reviewer", "programme manager"],
  steps: [
    {
      id: "4.1",
      title: "A proposal is reviewed through canonical resources with operator actions",
      status: "unit",
      note: "Covered in portal-event-proposals, portal-event-proposal-record, portal-proposal-detail-record, proposal-decision-panel, proposal-shared-components and presentation-versions-tab: the operator's commands are one actions menu and never reach an admin path, the submission answers sit under their questions, an accepted abstract is corrected through the proposal contract, the proposer's management page opens from the capability the server issues, a decision is previewed email by email before it is recorded, an accepted session is canceled with a comment to its speakers, and a presentation is uploaded on a speaker's behalf. Worker behavior is covered in admin-proposals-endpoints and proposal-decision-rounds.",
    },
    {
      id: "4.2",
      title: "A proposer edits the title and abstract while the proposal is open",
      status: "unit",
      note: "Covered in proposal-self-service-states through the mounted proposer routes, for a submitted and an under-review proposal, and in manage-read-endpoints for the session type.",
    },
    {
      id: "4.3",
      title: "A proposer adds, updates and removes a co-speaker while open",
      status: "unit",
      note: "Covered in proposal-self-service-states: the invitation, the per-proposal update and the removal, so a proposer who invites the wrong person can undo it themselves.",
    },
    {
      id: "4.4",
      title: "Acceptance freezes the abstract and keeps the speaker roster editable",
      status: "unit",
      note: "Covered in proposal-self-service-states and proposal-decision-rounds: an accepted proposal refuses a content change and still accepts a roster change. The asymmetry is the point: a programme is printed from the abstract, and who actually speaks can still change.",
    },
    {
      id: "4.5",
      title: "A rejected proposal closes both its content and its roster",
      status: "unit",
      note: "Covered in proposal-self-service-states, which also closes a withdrawn and a canceled proposal: the content change is refused with PROPOSAL_NOT_EDITABLE and the invitation leaves no speaker behind.",
    },
    {
      id: "4.6",
      title: "Presentation archives are offered only with proposal read access",
      status: "unit",
      note: "Covered in portal-event-proposals-section: a reader who may not read proposals is offered neither archive link, and one who may is offered the current versions as the default with both choices as links.",
    },
    {
      id: "4.7",
      title: "Proposal detail reads canonical proposal resources with no admin fallback",
      status: "covered",
      note: "The same endpoints serve every authorized reader. A fallback that only staff take is a second implementation nobody else exercises.",
    },
  ],
};
