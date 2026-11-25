import { previewScaleId } from "../seed-ids.mjs";

/**
 * One test account per team member per event role, addressed with a plus tag
 * on the member's own mailbox (`first.last+volunteer@pkic.org`), so each sign-in
 * link reaches them and each account holds exactly one role. Roles are granted
 * on the seeded event only, never site-wide.
 *
 * The roster is read at run time (team accounts on the source database plus
 * any addresses passed with --person); no address is stored in the repository.
 */
export const PERSONA_ROLES = [
  { tag: "organizer", roleId: "role-event_organizer" },
  { tag: "committee", roleId: "role-program_committee" },
  { tag: "moderator", roleId: "role-event_moderator" },
  { tag: "volunteer", roleId: "role-event_volunteer" },
  { tag: "studio", roleId: "role-event_studio_operator" },
  { tag: "attendee", roleId: null },
];

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
      AND organization.normalized_name = 'pki consortium'))
ORDER BY person.normalized_email`;

/** The same person can hold a team address and a company address; keep the team one. */
export function dedupeRoster(people) {
  const byName = new Map();
  for (const person of people) {
    const email = person.email.trim().toLowerCase();
    if (!/^[^@\s+]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error(`Not a plain mailbox address: ${person.email}`);
    const name = `${person.firstName} ${person.lastName}`.trim().toLowerCase();
    const current = byName.get(name);
    if (!current || (!current.email.endsWith("@pkic.org") && email.endsWith("@pkic.org")))
      byName.set(name, { ...person, email });
  }
  return [...byName.values()].sort((left, right) => left.email.localeCompare(right.email));
}

export function personaEmail(baseEmail, tag) {
  const [local, domain] = baseEmail.split("@");
  return `${local}+${tag}@${domain}`;
}

/** Every persona account for the roster, with stable ids keyed by address. */
/** Persona accounts are shared by every event; their role and registration belong to `eventId`. */
export function buildPersonas(roster, eventId) {
  return roster.flatMap((person) =>
    PERSONA_ROLES.map((role) => {
      const email = personaEmail(person.email, role.tag);
      return {
        email,
        tag: role.tag,
        roleId: role.roleId,
        firstName: person.firstName,
        lastName: person.lastName,
        userId: previewScaleId(`persona:${email}`),
        identityId: previewScaleId(`persona:${email}:individual`),
        roleAssignmentId: previewScaleId(`${eventId}:persona:${email}:role`),
        registrationId: previewScaleId(`${eventId}:persona:${email}:registration`),
      };
    }),
  );
}
