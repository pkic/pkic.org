import { first } from "../db/queries";
import type { DatabaseLike } from "../types";
import type { EventRecord } from "./events";
import { PROPOSAL_INACTIVE_STATUS_SQL_LIST } from "./proposal-status-policy";
import { portalVerifyLinkBase, requestUserSignInLink } from "./user-auth-flow";

/** Send one account sign-in link for an eligible speaker, without revealing whether one exists. */
export async function queueProposalSpeakerManageLinkRecovery(
  db: DatabaseLike,
  event: EventRecord,
  email: string,
  input: {
    appBaseUrl: string;
    signingSecret: string;
    ttlMinutes: number;
    ipHash: string | null;
    userAgentHash: string | null;
  },
): Promise<string | null> {
  const person = await first<{ email: string }>(
    db,
    `SELECT u.email FROM users u
    WHERE u.active = 1 AND u.pii_redacted_at IS NULL AND u.merged_into_user_id IS NULL
      AND (u.normalized_email = ? OR EXISTS (
        SELECT 1 FROM user_emails address WHERE address.user_id = u.id
          AND address.normalized_email = ? AND address.verified_at IS NOT NULL
      ))
      AND EXISTS (SELECT 1 FROM proposal_speakers ps
        JOIN session_proposals sp ON sp.id = ps.proposal_id
        WHERE ps.user_id = u.id AND ps.role <> 'proposer' AND ps.status IN ('invited', 'pending', 'confirmed')
          AND sp.event_id = ? AND sp.deleted_at IS NULL AND sp.status NOT IN (${PROPOSAL_INACTIVE_STATUS_SQL_LIST})
      ) LIMIT 1`,
    [email, email, event.id],
  );
  if (!person) return null;
  const result = await requestUserSignInLink(db, {
    email: person.email,
    signingSecret: input.signingSecret,
    ttlMinutes: input.ttlMinutes,
    ipHash: input.ipHash,
    userAgentHash: input.userAgentHash,
    magicLinkBaseUrl: portalVerifyLinkBase(input.appBaseUrl, `/events/${encodeURIComponent(event.slug)}/submissions`),
  });
  return result.outboxId;
}
