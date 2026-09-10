/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const JOIN_FLOW = {
  id: "join",
  title: "Join — member application",
  purpose:
    "Somebody asks to join the consortium; staff, the members and the executive council decide, and an approved application provisions a member with the identities and access that follow from it.",
  personas: ["applicant", "staff reviewer", "member", "executive council member"],
  steps: [
    {
      id: "1.0",
      title: "The public join form asks a factual organization question and routes on the answer",
      status: "covered",
      note: "Whether the applicant is joining for an organization decides the email path that follows, so the answer is a branch in the flow rather than a field on it.",
    },
    {
      id: "1.0.a",
      title: "An organization address is verified before the application can be submitted",
      status: "covered",
    },
    {
      id: "1.0.b",
      title: "An institutional address on the individual path stays an explicit policy exception",
      status: "covered",
      note: "Somebody at an institution may join as an individual, and the flow records that this was chosen rather than assumed.",
    },
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
      note: "A verified claimed domain routes an applicant to the existing Member. A second attempt by the same applicant produces no second application. Naming an organization that is already a member is refused at submission with that organization's name, so the applicant asks a representative rather than waiting on a review whose outcome was fixed before it opened (#27); an organization the consortium merely knows — a sponsor, a speaker's employer — is not a membership and does not refuse anything.",
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
};
