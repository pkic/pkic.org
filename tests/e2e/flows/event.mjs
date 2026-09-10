/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const EVENT_FLOW = {
  id: "event",
  title: "Event — from creation to who was in the room",
  purpose:
    "A group runs an event: it is created and configured, people register or are invited, attendance is managed per day, and external guests can be admitted to a meeting without an account.",
  personas: ["group manager", "attendee", "invited speaker", "external guest"],
  steps: [
    { id: "3.1", title: "A group manager creates and edits a group-owned event", status: "covered" },
    {
      id: "3.2",
      title: "Someone registers, confirms by email, and manages the registration afterwards",
      status: "covered",
      note: "One journey walks registration, invite acceptance, email confirmation, later edits through the manage link, and declining an invitation.",
    },
    {
      id: "3.2.a",
      title: "A registrant who lost the manage link can have it resent",
      status: "covered",
    },
    {
      id: "3.2.b",
      title: "Registering for an event joins the registrant to nothing else",
      status: "unit",
      note: "Issue #23. An event form asks for a name, an address and consent to a privacy policy; it does not ask whether somebody wants to represent their employer or sit in its working groups, so confirming one must not decide that — not even for an address under a domain a member organization has claimed, which is the exact signal the join flow uses to place a person inside an organization when they have asked to be there. Covered at the route in registration-workflows, because what is being asserted is the absence of identity, member, group-seat and mailing rows: a browser can only show the same absence more weakly, one screen at a time.",
    },
    { id: "3.3", title: "A manager changes an attendee's days", status: "covered" },
    { id: "3.4", title: "A manager manages attendee and speaker invitations", status: "covered" },
    { id: "3.5", title: "An external guest verifies a mailbox code and enters a meeting", status: "covered" },
    {
      id: "3.6",
      title: "A selected day that is full offers the waitlist rather than refusing outright",
      status: "covered",
      note: "The overall registration is confirmed and the full day is stated as pending, so somebody is never turned away from an event because one of its days filled.",
    },
    {
      id: "3.7",
      title: "An event that does not take registrations refuses one",
      status: "unit",
      note: "Covered in group-event-sharing. The group path folds the registration mode into the same atomic guard as live membership and the register grant, so it refuses as EVENT_REGISTRATION_ACCESS_REQUIRED where the public path says EVENT_REGISTRATION_DISABLED — one code for three reasons, which is the price of re-checking all of them in one statement at commit time. Refused, and nothing written, is what the test holds to.",
    },
    {
      id: "3.7.a",
      title: "A registration submitted after the event's stated closing time is refused",
      status: "absent",
      note: "DECIDED: enforce it on the public path, and let staff register somebody after the close — the late arrival a manager waves in — with each override written to the audit log, because it is a deliberate exception to a policy the site states publicly. Today nothing enforces it: `registration.closesAt` is read only by the reminder job, so a form submitted after the advertised close is accepted like any other. Separately there is no event cancellation to refuse against, since events carry no status at all.",
    },
    {
      id: "3.9",
      title: "Publishing an agenda fixes what it says, and republishing makes a revision beside it",
      status: "absent",
      note: "A published agenda is a document rather than a view: it says what it said on the day it was published, and a correction makes a second revision rather than editing the first. Nothing publishes one today — the agenda is rendered from live proposals and speakers every time it is read, so a talk retitled or a speaker changing employer silently rewrites a programme somebody has already printed. Revisions are what let a correction be made honestly: readers of the old one can still see what they were given, and the difference between the two is visible rather than silent.",
    },
    {
      id: "3.9.a",
      title: "A published agenda keeps the affiliations its speakers had at publication",
      status: "absent",
      note: "The reason 3.9 belongs beside the affiliation flow. Freezing at publication answers the programme case completely and without touching any record: the agenda holds what was true when it was published, whatever the speakers do afterwards. It answers only the programme, though — badges, attendee exports and the speaker wall are not the agenda and would still resolve live.",
    },
    {
      id: "3.10",
      title: "A manager sends every participant their own link to a meeting",
      status: "covered",
      note: "Issue #6. The link is the occurrence's join page rather than a per-person secret — a secret in a mailbox is the thing that gets forwarded — so it is personal by requiring the reader's own session, which is what binds the attendance it writes to a person. The journey sends a round and then opens the delivered link signed out, where it asks who the reader is instead of admitting them. Rounds, the compare-and-set that stops two managers mailing the group twice, and the refusals live in meeting-participant-invitations.",
    },
    {
      id: "3.8",
      title: "Single-use tokens, access control and hostile input on the public event surfaces",
      status: "covered",
    },
  ],
};
