/** @import { Flow } from "./types.mjs" */

/**
 * Two changes look identical in a form and mean opposite things.
 *
 * An organization is renamed: the same legal entity, a new name, and everybody
 * who speaks for it follows. A person changes employer: one person leaves one
 * organization and joins another, and nobody else moves with them.
 *
 * The schema already separates them. An identity is one person's affiliation
 * to one organization and carries its own lifecycle — invited, started, ended,
 * and a link to the identity it succeeded — so moving employer ends one and
 * starts another, while a rename touches the organization row every identity
 * points at. What is not settled is what the *record of the past* does when
 * either happens, and that is what these steps are about.
 *
 * @type {Flow}
 */
export const AFFILIATION_FLOW = {
  id: "affiliation",
  title: "Affiliation — who you speak for, and who you spoke for then",
  purpose:
    "A person's tie to an organization begins, ends, and is superseded, and every record made along the way has to keep saying what was true when it was made. Correcting an organization's name is a shared act; changing your own employer is not.",
  personas: ["member", "organization representative", "speaker", "event attendee", "staff"],
  steps: [
    {
      id: "14.1",
      title: "A representative corrects the organization's name, and everyone who speaks for it follows",
      status: "unit",
      note: "Covered in affiliation-rename-versus-move: the name was never copied onto anybody, so a rename reaches every identity at once, ends none of them, and creates no second organization beside the first. Which is right, and is exactly why it must be an act only a representative can perform.",
    },
    {
      id: "14.2",
      title: "A person changing employer moves alone",
      status: "unit",
      note: "Ending one tie and starting another: the colleague at the old organization is untouched, the ended tie still names where the mover was — which is what any record made back then resolves through — and the new one records the tie it succeeded, so the two read as one person's history rather than two strangers.",
    },
    {
      id: "14.3",
      title: "Membership is re-derived at the new employer, never carried from the old",
      status: "unit",
      note: "Membership belongs to the organization, not to the person who represented it, and the capacity is taken from the new employer's own membership rather than moved across. Writing this turned up the harder half: an organization identity cannot exist at all where the organization has no member aggregate — a trigger refuses it — so leaving for a company the consortium does not know as a Member is an ending with nothing to arrive at. The person holds no organization identity until that company becomes one, which is a product decision worth making deliberately rather than meeting as a constraint.",
    },
    {
      id: "14.0",
      title: "A speaker picks which identity a proposal is submitted under",
      status: "absent",
      note: "One person can hold two roles at the same organization, so the affiliation cannot be inferred from the organization alone. The speaker chooses, and the choice is what the record points at.",
    },
    {
      id: "14.0.a",
      title: "A submission made under the wrong role can be re-pointed to the right one",
      status: "absent",
      note: "Choosing wrongly is ordinary, and noticing afterwards is normal. Re-pointing a proposal at another identity, including one at a different organization, is a correction rather than a new submission.",
    },
    {
      id: "14.0.b",
      title: "Editing a role's title or bio warns that past contributions change with it",
      status: "absent",
      note: "The edit is allowed: a bio improved once should improve every listing. But changing a title in place rewrites talks already given, and the person doing it should be told that a new role is usually what they want instead.",
    },
    {
      id: "14.0.c",
      title: "Identity changes are audit logged, and summarized for leadership",
      status: "absent",
      note: "Audited like every other change. A periodic digest of who moved, who was renamed and which roles were edited gives the leadership sight of it without reading the log.",
    },
    {
      id: "14.4",
      title: "A ballot keeps the capacity it was cast in",
      status: "unit",
      note: "vote_ballots carries identity_id and member_id, so a ballot is frozen to the affiliation that cast it and a later job change cannot re-attribute a vote. Covered below the browser; worth stating here because getting it wrong rewrites a governance record.",
    },
    {
      id: "14.4.a",
      title: "A meeting attendance keeps the name and affiliation the attendee joined under",
      status: "unit",
      note: "Covered in meeting-entry-security: the record snapshots what the landing showed, and renaming the person or retitling their role afterwards does not reach it. This is the working precedent registrations and proposals lack — a record about a past moment, frozen at the moment.",
    },
    {
      id: "14.5",
      title: "A past event registration keeps the organization the attendee was there for",
      status: "gap",
      note: "DECIDED in principle: anchor the record to an identity, as vote_ballots already does, so a rename still reaches old records while a job change does not — and identities are to exist without membership so an external attendee has one to anchor to. Pending a deeper impact analysis before anything is built. Today registrations carries user_id alone, no identity and no organization at the time, so the employer resolves live and somebody who changes jobs retroactively attended every past event for their new one.",
    },
    {
      id: "14.6",
      title: "A speaker on a past proposal keeps the organization and role they spoke under",
      status: "gap",
      note: "DECIDED: link the identity. It freezes the organization by itself — an identity never moves between organizations — while bio, headshot and links stay shared, so a speaker enters them once instead of on every proposal and no session overwrites what another collected. A past listing shows the role as spoken, not whatever the person does later. Bio and title still follow the identity if it is edited, which 14.0.b covers with a warning rather than a prohibition. A published agenda (event 3.9) freezes the document as issued, which is a separate thing from the record and not a substitute for it. The point of an identity is that a bio and a headshot are entered once and updated when they change, so a fifth talk and a tenth event resolve through the same tie rather than asking again. Today a proposal can hold per-speaker overrides and the record holds where one was set; where none was, the card falls back to users.organization_name and follows the person, so a programme reprints with an affiliation that was never true of that talk.",
    },
    {
      id: "14.7",
      title: "A proposer editing a co-speaker changes only that proposal",
      status: "covered",
      note: "The proposer may set another speaker's name, organization, job title, biography and links. It writes a per-proposal override rather than the person's own profile, which is the design that makes the authority safe to hand out.",
    },
  ],
};
