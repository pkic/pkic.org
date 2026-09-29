/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const VOTE_FLOW = {
  id: "vote",
  title: "Vote — eligibility, ballot, and the window",
  purpose:
    "A group puts a question or an election to its eligible members, each votes once per capacity they hold, and the result is only counted inside the window.",
  personas: ["group manager", "eligible member", "member representing two organizations"],
  steps: [
    {
      id: "5.12",
      title: "A proposal becomes a reachable vote through endorsement or manager approval",
      status: "covered",
    },
    { id: "5.1", title: "A person representing two organizations casts a separate ballot for each", status: "covered" },
    { id: "5.2", title: "Changing your mind replaces your ballot rather than adding one", status: "covered" },
    { id: "5.3", title: "An election is decided by choosing from the candidate list", status: "covered" },
    { id: "5.4", title: "The ballot box is shut before the window opens and after it closes", status: "covered" },
    { id: "5.5", title: "A member outside the eligible categories is told so and cannot cast", status: "covered" },
    {
      id: "5.6",
      title: "How somebody voted is shown only as far as the vote's own visibility allows",
      status: "unit",
      note: "Projected in the participation history behind the vote's visibility and public_detail_level; covered in user-participation-history. Worth stating here because getting it wrong publishes a confidential ballot rather than losing a feature.",
    },
    {
      id: "5.7",
      title: "A manager opens a scheduled vote and closes it through the lifecycle actions",
      status: "covered",
    },
    {
      id: "5.8",
      title: "A manager backs out of cancelling once, then cancels with a reason",
      status: "covered",
      note: "Backing out is walked first: a cancel that cannot be abandoned is a cancel somebody performs by accident.",
    },
    {
      id: "5.9",
      title: "A member proposes a vote, endorses and withdraws their endorsement, and staff rejects it",
      status: "covered",
      note: "Endorsement is what carries a proposal to a ballot, so withdrawing one has to work as well as giving it.",
    },
    {
      id: "5.10",
      title: "A manager shares a vote with another group, then revokes the grant",
      status: "covered",
    },
    {
      id: "5.11",
      title: "The public votes page lists an open vote and renders closed results",
      status: "covered",
    },
  ],
};
