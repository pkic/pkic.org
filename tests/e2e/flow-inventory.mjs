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
 * `status` is a statement about coverage, never permission to skip:
 *   - "covered"  a spec walks this step
 *   - "unit"     the behaviour is tested below the browser only
 *   - "gap"      nothing tests it
 *   - "absent"   the product does not do this yet
 *
 * Keeping "gap" and "absent" apart matters. A gap is work; an absent step is a
 * decision, and reading one as the other is how a missing feature turns into a
 * missing test nobody writes.
 */

/** @typedef {"covered" | "unit" | "gap" | "absent"} StepStatus */

export const FLOWS = [
  {
    id: "join",
    title: "Join — member application",
    purpose:
      "Somebody asks to join the consortium; staff, the members and the executive council decide, and an approved application provisions a member with the identities and access that follow from it.",
    personas: ["applicant", "staff reviewer", "member", "executive council member"],
    steps: [
      {
        id: "1.1",
        title: "Submit an application in each membership category",
        status: "covered",
        note: "The category sets are covered — organization-tied versus individual — and a non-default category. Each individual category is not walked separately, which is defensible: the category is data the form offers, not a branch in the flow.",
      },
      {
        id: "1.1.a",
        title: "Refuse a duplicate application, or one for an organization already known",
        status: "covered",
        note: "A verified claimed domain routes an applicant to the existing Member. A second attempt by the same applicant produces no second application. An organization name that already exists is deliberately not refused — two organizations may legitimately share one, and staff resolve it at review.",
      },
      {
        id: "1.1.b",
        title: "Refuse invalid data and unaccepted terms at the field that caused it",
        status: "covered",
        note: "Every unaccepted agreement is named on its own key with the sentence the applicant was shown, so the form marks the boxes that were missed rather than showing one refusal above four identical checkboxes.",
      },
      {
        id: "1.1.c",
        title: "Continue into an existing organization when the address is under a verified domain",
        status: "covered",
      },
      {
        id: "1.2",
        title: "Staff review: move the application through its stages, approve or decline",
        status: "covered",
        note: "Declined is terminal and never reaches onboarding.",
      },
      {
        id: "1.2.a",
        title: "Staff ask the applicant a question, and record an internal note",
        status: "covered",
        note: "The Communications card sends applicant email and records staff-only notes.",
      },
      {
        id: "1.3",
        title: "Staff open a member consultation on the application",
        status: "covered",
        note: "The stage walk visits in_consultation and back out of it.",
      },
      {
        id: "1.3.a",
        title: "The membership is notified of applications in consultation, in one batch",
        status: "unit",
        note: "membership-scheduled-jobs covers the batch thoroughly: queued at most once, bounded so no application starves, safe under concurrent runners, and never sending details an admin edit has since changed. It is cron-driven rather than something a person does in a browser, so a spec would be walking a scheduled job through the UI it does not have.",
      },
      {
        id: "1.4",
        title: "Executive council review: silence approves once the window closes",
        status: "unit",
        note: "runEcWindowAutoApprove approves an overdue application and logs auto_approved_no_ec_objection. Bounded by a LIMIT rather than scanning every overdue application. Cron-driven, as above.",
      },
      {
        id: "1.4.a",
        title: "An executive council objection stops the automatic approval",
        status: "unit",
        note: "An overdue application carrying an EC decline is held for staff resolution instead of auto-approving. This is the half worth guarding: silence approving is the default path, and an objection being ignored would approve a member the council refused.",
      },
      {
        id: "1.5",
        title: "Approval provisions the member, its identities and the access that follows",
        status: "covered",
      },
    ],
  },
  {
    id: "sponsor",
    title: "Sponsorship — inquiry to sponsor workspace",
    purpose:
      "An organization offers to sponsor the consortium or one of its events; staff turn that into a sponsorship, and the sponsor gets a workspace and a place on the wall.",
    personas: ["prospective sponsor", "staff", "sponsor contact"],
    steps: [
      { id: "2.1", title: "Submit a generic consortium sponsor inquiry against the configured tiers", status: "covered" },
      { id: "2.2", title: "Submit an inquiry for a named tier on a specific event", status: "covered" },
      {
        id: "2.3",
        title: "Staff turn an inquiry into a sponsorship and advance it through the pipeline",
        status: "covered",
        note: "The stage advance and its history are walked in portal-management-verification.",
      },
      {
        id: "2.4",
        title: "A sponsor contact reaches their workspace through a mailbox link",
        status: "covered",
      },
      { id: "2.5", title: "The sponsor appears on the wall, paged", status: "covered" },
      {
        id: "2.6",
        title: "An inquiry for a tier that is full, withdrawn, or on a closed event",
        status: "gap",
        note: "Nothing walks an inquiry that must be refused. A tier with no places left is the case worth having: it is the one a sponsor hits at the worst moment, and the refusal has to say which tier and what else is available rather than failing as an invalid request.",
      },
    ],
  },
  {
    id: "event",
    title: "Event — from creation to who was in the room",
    purpose:
      "A group runs an event: it is created and configured, people register or are invited, attendance is managed per day, and external guests can be admitted to a meeting without an account.",
    personas: ["group manager", "attendee", "invited speaker", "external guest"],
    steps: [
      { id: "3.1", title: "A group manager creates and edits a group-owned event", status: "covered" },
      {
        id: "3.2",
        title: "Someone registers for an event and the registration is confirmed",
        status: "gap",
        note: "Registration has substantial unit coverage — admission, waitlist claim, day capacity, email change races — and no browser journey from the public form through confirmation. This is the highest-traffic public flow in the product.",
      },
      { id: "3.3", title: "A manager changes an attendee's days", status: "covered" },
      { id: "3.4", title: "A manager manages attendee and speaker invitations", status: "covered" },
      { id: "3.5", title: "An external guest verifies a mailbox code and enters a meeting", status: "covered" },
      {
        id: "3.6",
        title: "Registration closes, fills, or is cancelled, and says so",
        status: "gap",
        note: "The refusal paths are policy tested in event-registration-status-policy and day-attendance-capacity, and never walked. A full event that lets somebody complete a form before refusing them is the failure mode.",
      },
    ],
  },
  {
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
    ],
  },
  {
    id: "vote",
    title: "Vote — eligibility, ballot, and the window",
    purpose:
      "A group puts a question or an election to its eligible members, each votes once per capacity they hold, and the result is only counted inside the window.",
    personas: ["group manager", "eligible member", "member representing two organizations"],
    steps: [
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
    ],
  },
  {
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
        title: "Somebody answers a placed form and the response is stored against its revision",
        status: "gap",
        note: "Revisioning, field rules and answer attribution are unit tested. No journey submits a form as a person and reads the answer back, which is where a definition edited mid-flight would show itself.",
      },
    ],
  },
];

/** Every step id, as `<flow>.<step>`. */
export function flowStepIds() {
  return FLOWS.flatMap((flow) => flow.steps.map((step) => `${flow.id}.${step.id}`));
}

/** The step ids a spec is expected to claim. */
export function claimedStepIds() {
  return FLOWS.flatMap((flow) =>
    flow.steps.filter((step) => step.status === "covered").map((step) => `${flow.id}.${step.id}`),
  );
}
