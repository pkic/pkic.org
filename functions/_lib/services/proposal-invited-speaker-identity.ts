import { all } from "../db/queries";
import { normalizeEmail } from "../validation";
import type { DatabaseLike } from "../types";
import { resolveEmailDomainOrganization } from "./identities/verified-email-domain";
import { prepareProposalActingIdentity, type PreparedProposalActingIdentity } from "./proposal-speaker-identity";

const ACTIVE_ORGANIZATION_IDENTITY = `identity.organization_id IS NOT NULL AND identity.started_at IS NOT NULL
  AND identity.ended_at IS NULL AND identity.blocked_at IS NULL`;

/** Exactly one candidate, or none: two would be a choice only the speaker can make. */
async function onlyIdentity(db: DatabaseLike, sql: string, bindings: unknown[]): Promise<string | null> {
  const rows = await all<{ id: string }>(db, `${sql} ORDER BY identity.id LIMIT 2`, bindings);
  return rows.length === 1 ? rows[0]!.id : null;
}

/**
 * The representation an invited speaker is attached to when the proposer adds
 * them, by the rule that links a proposer's confirmed address: the person's
 * own active organization identity held through the invited address, else the
 * one for the organization that address's domain belongs to. It is selected
 * through the same use case a proposer's choice is, so the agenda, badges and
 * profile read one recorded representation.
 *
 * Nothing is attached when the address links to no identity the person holds,
 * or the identity has no job title: the speaker's own invitation step then
 * proves the mailbox and creates or chooses the identity themselves, as the
 * proposer does. No identity is created or activated here, because nobody has
 * proved the invited mailbox yet.
 */
export async function prepareInvitedSpeakerRepresentation(
  db: DatabaseLike,
  input: { userId: string; email: string; at: string },
): Promise<PreparedProposalActingIdentity | undefined> {
  const throughAddress = await onlyIdentity(
    db,
    `SELECT identity.id FROM identities identity
       JOIN users person ON person.id = identity.user_id
       LEFT JOIN user_emails address ON address.id = identity.email_id AND address.user_id = identity.user_id
      WHERE identity.user_id = ? AND ${ACTIVE_ORGANIZATION_IDENTITY}
        AND CASE WHEN identity.email_id IS NULL THEN person.normalized_email ELSE address.normalized_email END = ?`,
    [input.userId, normalizeEmail(input.email)],
  );
  let identityId = throughAddress;
  if (!identityId) {
    const { resolution } = await resolveEmailDomainOrganization(db, input.email);
    if (resolution.kind === "organization")
      identityId = await onlyIdentity(
        db,
        `SELECT identity.id FROM identities identity
          WHERE identity.user_id = ? AND identity.organization_id = ? AND ${ACTIVE_ORGANIZATION_IDENTITY}`,
        [input.userId, resolution.organizationId],
      );
  }
  if (!identityId) return undefined;
  const prepared = await prepareProposalActingIdentity(db, {
    userId: input.userId,
    actingIdentityId: identityId,
    at: input.at,
  });
  return prepared.representation.jobTitle?.trim() ? prepared : undefined;
}
