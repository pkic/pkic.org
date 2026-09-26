/** @import { Flow } from "./types.mjs" */

/** @type {Flow} */
export const SYSTEM_FLOW = {
  id: "system",
  title: "System — the desk the platform is run from",
  purpose:
    "The surfaces staff use to run the consortium rather than to participate in it: the people and organizations on the platform, what has been done to them, the money, the mail it sends, and the settings the public join flow is generated from.",
  personas: ["staff", "permitted staff", "read-only staff"],
  steps: [
    {
      id: "12.1",
      title: "Staff manage users, filter and sort the list, and grant or revoke the administrator role",
      status: "covered",
      note: "Granting administrator from a list row is walked with its revocation, because the row is where it is easiest to do by accident.",
    },
    {
      id: "12.2",
      title: "The audit log is read only through the portal, and pages through its states",
      status: "covered",
      note: "Loading, empty and paginated. An audit log that renders nothing on an empty page is indistinguishable from one that failed to load.",
    },
    {
      id: "12.3",
      title: "Staff read focused platform analytics",
      status: "covered",
    },
    {
      id: "12.3.a",
      title: "Each domain answers for its own numbers, on a page under it",
      status: "covered",
      note: "The figures used to be one system-wide panel inside Settings, which put the membership numbers under a heading that named none of them and three clicks from the roll they describe (#39). Members, organizations and users each have an analytics page under their own section now, beside the event and donation pages that already did. Every one of those addresses is a reserved segment matched before its section's `:id` route, or \"analytics\" is read as the id of a record.",
    },
    {
      id: "12.4",
      title: "Staff manage donations, filter by status, and reach the badge and sync controls",
      status: "covered",
    },
    {
      id: "12.5",
      title: "The outbox, the due queue and the job registry are each read and driven from their own page",
      status: "covered",
      note: 'They were three tabs inside one "Operations" bucket, so none of them could be linked to and the entry named none of them. The walk now reaches each by its own name in the sidebar and asserts its address.',
    },
    {
      id: "12.6",
      title: "Staff create, preview, activate and reopen an email template",
      status: "covered",
      note: "Preview before activate is the point: a template goes out to the membership, and the draft is the last place to read it.",
    },
    {
      id: "12.7",
      title:
        "The application workflow, the application form and the category catalog are each edited on their own page",
      status: "covered",
      note: "The join form the public fills in is generated from these settings, so this step is where a staff edit becomes a change to a public page. The three subjects shared one screen until they were split, and the walk now edits each at its own address.",
    },
    {
      id: "12.11",
      title: "Staff read the members roll and grant an individual membership from it",
      status: "covered",
      note: "Membership is a grant on somebody who already exists, not a record created from nothing — so the roll and the grant are one surface. Only the API could do it before, which meant an H5/H6/H7 member could not be added without curl.",
    },
    {
      id: "12.0",
      title: "Two accounts for the same person can be merged into one",
      status: "absent",
      note: "users carries merged_into_user_id and several services already refuse to act on a row that has it, so the schema and the guards anticipate a merge — but nothing writes it. There is no route and no service, so a person who arrived twice through the migration stays twice, and staff can only pick one and hope. Found by a person hitting it, not by a test.",
    },
    {
      id: "12.0.a",
      title: "A person with no name is visible to staff before a public roster shows them",
      status: "absent",
      note: "A holder with neither first nor last name is published as \"Unknown\" on a group's public roster — honest, since the seat exists and its holder's name does not, but the first anybody hears of it is the public page. Staff surfaces fall back to the email, so the gap is legible internally and nothing brings it to attention.",
    },
    {
      id: "12.8",
      title: "Erasing a person leaves the organizational fact that outlives them",
      status: "unit",
      note: "Erasure is a legal obligation and is not negotiable, so the person goes. What must survive is the fact the consortium relies on: a representative of this organization accepted these terms, in this version, on this date. Covered in admin-user-management — the acceptance keeps its term, version and date while the user row loses its name, organization and address. The assertion is about direction: anonymization redacts the person and revokes their access, and must not follow the foreign keys outward into the record of what their organization did.",
    },
    {
      id: "12.9",
      title: "Members are reminded annually what their organization has agreed to",
      status: "absent",
      note: "DECIDED: one fixed date each year, to every member organization's representatives. The agreement was made once, at signup, and binds the organization rather than the person who signed, so the reminder renews nobody's consent and is not asked to — it keeps the people who hold it now aware of terms they did not personally accept. A single consortium-wide send reads as a notice to the membership rather than something aimed at one member.",
    },
    {
      id: "12.10",
      title: "Joining a meeting reminds the attendee of the conditions, and the attendance record says which",
      status: "absent",
      note: 'DECIDED: shown as a reminder, with the conditions carried on the attendance record that already exists. Code of conduct, IPR, and the bylaws including their anti-trust policy, named as somebody joins — a reminder, not a contract: the binding acceptance was made at signup by the organization, and re-asking here would imply the terms were not already in force. No new table. Attendance is already its own record per join and already snapshots a name and an affiliation, so what was shown belongs beside them. Which terms, not merely which version: they are configured per event in event_terms, so a working group\'s call and a plenary can name different conditions, and a record saying only "version 3" cannot say of what. It survives the erasure of any individual, because it is a fact about a seat rather than about a person.',
    },
  ],
};
