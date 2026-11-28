import { previewScaleId } from "../seed-ids.mjs";

/**
 * One test account per team member per event role, addressed with a plus tag
 * on the member's own mailbox (`first.last+volunteer@pkic.org`), so each sign-in
 * link reaches them and each account holds exactly one role. Roles are granted
 * on the seeded event only, never site-wide. The role's label follows the
 * person's name ("Paul van Brouwershaven Organizer", initials PO), so the avatar, the
 * header, the profile and every list say which test account is signed in.
 *
 * The roster is read at run time (team accounts on the source database plus
 * any addresses passed with --person); no address is stored in the repository.
 */
export const PERSONA_ROLES = [
  { tag: "organizer", label: "Organizer", roleId: "role-event_organizer", jobTitle: "Event Organizer" },
  { tag: "committee", label: "Committee", roleId: "role-program_committee", jobTitle: "Program Committee Member" },
  { tag: "moderator", label: "Moderator", roleId: "role-event_moderator", jobTitle: "Session Moderator" },
  { tag: "volunteer", label: "Volunteer", roleId: "role-event_volunteer", jobTitle: "Event Volunteer" },
  { tag: "studio", label: "Studio", roleId: "role-event_studio_operator", jobTitle: "Studio Operator" },
  { tag: "attendee", label: "Attendee", roleId: null, jobTitle: "Attendee", registers: true },
  // Represents a seeded sponsor: an identity at its organization and the sponsorship's contact address.
  { tag: "sponsor", label: "Sponsor", roleId: null, jobTitle: "Partnerships Manager", sponsor: true },
];

/**
 * Staff personas speak for this organization. The seed finds it by name (its
 * domain is shared with other organizations) and skips the identity when absent.
 */
export const TEAM_ORGANIZATION_NAMES_SQL = "('pki consortium', 'pki consortium, inc.')";

/**
 * Team accounts: an active personal @pkic.org address without a plus tag, or a
 * PKI Consortium identity. The shared admin mailbox belongs to no one person.
 */
export const TEAM_ROSTER_SQL = `SELECT DISTINCT person.first_name AS firstName, person.last_name AS lastName, person.normalized_email AS email
FROM users person
WHERE person.active = 1 AND person.merged_into_user_id IS NULL AND person.pii_redacted_at IS NULL
  AND person.normalized_email NOT LIKE '%+%' AND person.normalized_email <> 'admin@pkic.org' AND person.first_name IS NOT NULL AND person.last_name IS NOT NULL
  AND (person.normalized_email LIKE '%@pkic.org' OR EXISTS (
    SELECT 1 FROM identities held JOIN organizations organization ON organization.id = held.organization_id
    WHERE held.user_id = person.id AND held.started_at IS NOT NULL AND held.ended_at IS NULL
      AND organization.normalized_name IN ${TEAM_ORGANIZATION_NAMES_SQL}))
ORDER BY person.normalized_email`;

/**
 * The same person can hold a team address and a company address; keep the team
 * one. Where the records spell the name differently, keep the spelling with
 * the most words ("van Brouwershaven", not "Vanbrouwershaven").
 */
export function dedupeRoster(people) {
  const byName = new Map();
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    if (!/^[^@\s+]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Not a plain mailbox address: ${person.email}`);
    // "van Brouwershaven" and "Vanbrouwershaven" are one person.
    const name = `${person.firstName}${person.lastName}`.toLowerCase().replace(/[^\p{L}]/gu, "");
    const current = byName.get(name);
    const keepAddress = current && !(!current.email.endsWith("@pkic.org") && email.endsWith("@pkic.org"));
    const kept = keepAddress ? current : { ...person, email };
    const other = keepAddress ? person : current;
    byName.set(name, other && wordCount(other) > wordCount(kept) ? { ...kept, firstName: other.firstName, lastName: other.lastName } : kept);
  }
  return [...byName.values()].sort((left, right) => left.email.localeCompare(right.email));
}

function wordCount(person) {
  return `${person.firstName} ${person.lastName}`.trim().split(/\s+/).length;
}

export function personaEmail(baseEmail, tag) {
  const [local, domain] = baseEmail.split("@");
  return `${local}+${tag}@${domain}`;
}

/**
 * Every persona account for the roster, with stable ids keyed by address.
 * Accounts are shared by every event; their role, registration and sponsorship
 * belong to `eventId`. Each team member represents a different sponsorship.
 */
export function buildPersonas(roster, eventId, sponsorships = []) {
  return roster.flatMap((person, index) =>
    PERSONA_ROLES.filter((role) => !role.sponsor || sponsorships.length > 0).map((role) => {
      const email = personaEmail(person.email, role.tag);
      const sponsorship = role.sponsor ? sponsorships[index % sponsorships.length] : null;
      return {
        email,
        tag: role.tag,
        roleId: role.roleId,
        jobTitle: role.jobTitle,
        registers: role.registers === true,
        sponsorship,
        // A sponsor account's identity is keyed by its sponsor, so a roster change that moves it to another sponsorship adds the new identity.
        organizationIdentityId: previewScaleId(
          sponsorship ? `persona:${email}:organization:${sponsorship.organizationId}` : `persona:${email}:organization`,
        ),
        firstName: person.firstName,
        lastName: `${person.lastName} ${role.label}`,
        userId: previewScaleId(`persona:${email}`),
        identityId: previewScaleId(`persona:${email}:individual`),
        roleAssignmentId: previewScaleId(`${eventId}:persona:${email}:role`),
        registrationId: previewScaleId(`${eventId}:persona:${email}:registration`),
      };
    }),
  );
}
