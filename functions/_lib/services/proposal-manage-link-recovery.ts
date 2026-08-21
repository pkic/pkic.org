import { all } from "../db/queries";
import { prepareBulkQueueEmailChunkStatements } from "../email/outbox";
import type { DatabaseLike } from "../types";
import { queuedCapabilityToken } from "./capability-links";
import { buildEventEmailVariables, type EventRecord } from "./events";
import { proposalManagePageUrl } from "./frontend-links";
import { bulkBuildProposalInviteEmailContexts } from "./reminders/shared";

interface ProposalMatch {
  proposal_id: string;
  proposer_user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  title: string;
  abstract: string;
  proposal_type: string;
}

/** Queues bounded, enumeration-safe proposal management-link recovery mail. */
export async function queueProposalManageLinkRecovery(
  db: DatabaseLike,
  event: EventRecord,
  email: string,
  appBaseUrl: string,
): Promise<string[]> {
  const proposals = await all<ProposalMatch>(
    db,
    `SELECT sp.id AS proposal_id, sp.proposer_user_id, u.email, u.first_name,
            u.last_name, sp.title, sp.abstract, sp.proposal_type
       FROM session_proposals sp
       JOIN users u ON u.id = sp.proposer_user_id
      WHERE sp.event_id = ? AND lower(u.email) = lower(?)
        AND sp.status NOT IN ('rejected', 'withdrawn')
      ORDER BY sp.submitted_at DESC
      LIMIT 20`,
    [event.id, email],
  );
  if (proposals.length === 0) return [];

  const proposalIds = proposals.map((proposal) => proposal.proposal_id);
  const [inviteContexts, referralRows] = await Promise.all([
    bulkBuildProposalInviteEmailContexts(db, proposalIds),
    all<{ owner_id: string; code: string }>(
      db,
      `SELECT owner_id, code
         FROM referral_codes
        WHERE event_id = ? AND owner_type = 'proposal'
          AND owner_id IN (SELECT value FROM json_each(?))
        ORDER BY created_at ASC`,
      [event.id, JSON.stringify(proposalIds)],
    ),
  ]);
  const referralByProposal = new Map<string, string>();
  for (const referral of referralRows) {
    if (!referralByProposal.has(referral.owner_id)) referralByProposal.set(referral.owner_id, referral.code);
  }

  const eventVariables = buildEventEmailVariables(event, appBaseUrl);
  const chunks = prepareBulkQueueEmailChunkStatements(
    db,
    proposals.map((proposal) => {
      const manageUrl = proposalManagePageUrl(
        appBaseUrl,
        event,
        queuedCapabilityToken("proposal_manage", proposal.proposal_id),
      );
      const referralCode = referralByProposal.get(proposal.proposal_id);
      return {
        eventId: event.id,
        templateKey: "proposal_submitted",
        recipientEmail: proposal.email,
        recipientUserId: proposal.proposer_user_id,
        messageType: "transactional" as const,
        subject: `Your proposal management link for ${event.name}: ${proposal.title}`,
        capabilityLinkValues: [manageUrl],
        data: {
          ...eventVariables,
          firstName: proposal.first_name ?? "",
          lastName: proposal.last_name ?? "",
          proposalTitle: proposal.title,
          proposalAbstract: proposal.abstract,
          proposalType: proposal.proposal_type,
          speakerLineupText: inviteContexts.get(proposal.proposal_id)?.speakerLineupText ?? "",
          manageUrl,
          shareUrl: referralCode ? `${appBaseUrl}/r/${referralCode}` : "",
        },
      };
    }),
  );
  await db.batch(chunks.map((chunk) => chunk.statement));
  return chunks.flatMap((chunk) => chunk.ids);
}
