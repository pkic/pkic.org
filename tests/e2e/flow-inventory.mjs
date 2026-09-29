/**
 * The user flows this product has, and the steps each one is made of.
 *
 * Written down because "what is covered end to end?" was a question only a
 * person reading every spec could answer, and the answer went stale the moment
 * anyone added a test. A step here is a thing a person does or a thing the
 * system must do in response — not a test name, and not a route.
 *
 * A spec claims a step with a `@covers <flow>.<step>` comment.
 * `scripts/check-flow-coverage.mjs` enforces the claims: a step marked
 * `covered` must have a spec claiming it, and a claim must name a step that
 * exists. Steps with no claim are reported every run.
 *
 * One flow per module under `flows/`, because a flow is the unit people read
 * and edit, and because the whole inventory in one file outgrew the size any
 * of it could be found in. This file is only the order they are read in.
 *
 * @import { Flow } from "./flows/types.mjs"
 */
import { ACCOUNT_FLOW } from "./flows/account.mjs";
import { AFFILIATION_FLOW } from "./flows/affiliation.mjs";
import { AUTHORITY_FLOW } from "./flows/authority.mjs";
import { EVENT_FLOW } from "./flows/event.mjs";
import { FORM_FLOW } from "./flows/form.mjs";
import { GROUPS_FLOW } from "./flows/groups.mjs";
import { JOIN_FLOW } from "./flows/join.mjs";
import { ORGANIZATION_FLOW } from "./flows/organization.mjs";
import { PRESENTATION_FLOW } from "./flows/presentation.mjs";
import { PROFILE_FLOW } from "./flows/profile.mjs";
import { PROPOSAL_FLOW } from "./flows/proposal.mjs";
import { SPONSOR_FLOW } from "./flows/sponsor.mjs";
import { SYSTEM_FLOW } from "./flows/system.mjs";
import { VOTE_FLOW } from "./flows/vote.mjs";

/**
 * Ordered as somebody meets the product: joining it, paying into it, the work
 * it exists to do, then the account and authority every one of those rests on,
 * then the desk it is run from, and last the conditions all of it needs.
 *
 * @type {Flow[]}
 */
export const FLOWS = [
  JOIN_FLOW,
  SPONSOR_FLOW,
  EVENT_FLOW,
  PROPOSAL_FLOW,
  VOTE_FLOW,
  FORM_FLOW,
  ACCOUNT_FLOW,
  GROUPS_FLOW,
  AUTHORITY_FLOW,
  ORGANIZATION_FLOW,
  PROFILE_FLOW,
  SYSTEM_FLOW,
  AFFILIATION_FLOW,
  PRESENTATION_FLOW,
];

export function flowStepIds() {
  return FLOWS.flatMap((flow) => flow.steps.map((step) => `${flow.id}.${step.id}`));
}

/** The step ids a spec is expected to claim. */
export function claimedStepIds() {
  return FLOWS.flatMap((flow) =>
    flow.steps.filter((step) => step.status === "covered").map((step) => `${flow.id}.${step.id}`),
  );
}
