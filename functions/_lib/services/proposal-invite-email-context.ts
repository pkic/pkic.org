import { all, first } from "../db/queries";
import { emailPlainText } from "../email/plain-text";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { stringifyJson } from "../utils/json";
import { formatProposalInvitePerson, type ProposalInvitePerson } from "./proposal-invite-person";
import { proposalSpeakerProfileColumns } from "./proposal-speakers";
import { selectedOrAffiliationOrganizationNameSql } from "./identities/affiliation-projection";

/** The inviter appears with the identity they act as on this proposal, else their affiliation. */
function inviterOrganizationNameSql(proposalIdSql: string, userIdSql: string): string {
  return selectedOrAffiliationOrganizationNameSql(
    `(SELECT inviter_speaker.acting_identity_id FROM proposal_speakers inviter_speaker
       WHERE inviter_speaker.proposal_id = ${proposalIdSql} AND inviter_speaker.user_id = ${userIdSql})`,
    userIdSql,
  );
}

export interface ProposalInviteEmailContext {
  invitedByDisplay: string;
  inviterFirstName?: string;
  proposalTitle: string;
  proposalAbstract: string;
  speakerLineupText: string;
}

/** Converts public proposal/person fields into content-type-aware literal email values. */
export function proposalInviteEmailTextVariables(context: ProposalInviteEmailContext) {
  return {
    proposerFirstName: emailPlainText(context.inviterFirstName ?? ""),
    invitedByDisplay: emailPlainText(context.invitedByDisplay),
    proposalTitle: emailPlainText(context.proposalTitle),
    proposalAbstract: emailPlainText(context.proposalAbstract),
    speakerLineupText: emailPlainText(context.speakerLineupText),
  };
}

interface ProposalInviteSummary {
  id: string;
  title: string;
  abstract: string;
  proposer_user_id: string;
}

export function composeProposalInviteEmailContext(
  proposal: ProposalInviteSummary,
  inviter: ProposalInvitePerson | null,
  speakers: ProposalInvitePerson[],
): ProposalInviteEmailContext {
  return {
    invitedByDisplay: inviter ? formatProposalInvitePerson(inviter) : "The proposer",
    inviterFirstName: inviter?.first_name ?? "",
    proposalTitle: proposal.title,
    proposalAbstract: proposal.abstract,
    speakerLineupText: speakers.map((speaker) => `- ${formatProposalInvitePerson(speaker)}`).join("\n"),
  };
}

export async function buildProposalInviteEmailContext(
  db: DatabaseLike,
  payload: { proposalId: string; inviterUserId?: string | null },
): Promise<ProposalInviteEmailContext> {
  const row = await first<
    ProposalInviteSummary & {
      inviter_email: string | null;
      inviter_first_name: string | null;
      inviter_last_name: string | null;
      inviter_organization_name: string | null;
    }
  >(
    db,
    `SELECT sp.id, sp.title, sp.abstract, sp.proposer_user_id,
            u.email AS inviter_email,
            u.first_name AS inviter_first_name,
            u.last_name AS inviter_last_name,
            ${inviterOrganizationNameSql("sp.id", "u.id")} AS inviter_organization_name
       FROM session_proposals sp
       LEFT JOIN users u ON u.id = COALESCE(?, sp.proposer_user_id)
      WHERE sp.id = ?`,
    [payload.inviterUserId ?? null, payload.proposalId],
  );
  if (!row) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");

  const speakers = await all<ProposalInvitePerson>(
    db,
    `SELECT u.email, ${proposalSpeakerProfileColumns("u", "ps", "", ["firstName", "lastName", "organizationName"])}
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.proposal_id = ?
      ORDER BY ps.created_at ASC`,
    [row.id],
  );
  const inviter = row.inviter_email
    ? {
        email: row.inviter_email,
        first_name: row.inviter_first_name,
        last_name: row.inviter_last_name,
        organization_name: row.inviter_organization_name,
      }
    : null;
  return composeProposalInviteEmailContext(row, inviter, speakers);
}

/** Resolves many proposal email contexts in three set-based D1 reads. */
export async function buildProposalInviteEmailContextMap(
  db: DatabaseLike,
  proposalIds: string[],
): Promise<Map<string, ProposalInviteEmailContext>> {
  if (proposalIds.length === 0) return new Map();

  const proposalIdsJson = stringifyJson(proposalIds);
  const proposals = await all<ProposalInviteSummary>(
    db,
    `SELECT id, title, abstract, proposer_user_id
       FROM session_proposals
      WHERE id IN (SELECT value FROM json_each(?))`,
    [proposalIdsJson],
  );
  type ProposalSpeaker = ProposalInvitePerson & { proposal_id: string };
  const [proposers, speakers] = await Promise.all([
    all<ProposalSpeaker>(
      db,
      `SELECT sp.id AS proposal_id, u.email, u.first_name, u.last_name,
              ${inviterOrganizationNameSql("sp.id", "u.id")} AS organization_name
         FROM session_proposals sp
         JOIN users u ON u.id = sp.proposer_user_id
        WHERE sp.id IN (SELECT value FROM json_each(?))`,
      [proposalIdsJson],
    ),
    all<ProposalSpeaker>(
      db,
      `SELECT ps.proposal_id, u.email,
              ${proposalSpeakerProfileColumns("u", "ps", "", ["firstName", "lastName", "organizationName"])}
         FROM proposal_speakers ps
         JOIN users u ON u.id = ps.user_id
        WHERE ps.proposal_id IN (SELECT value FROM json_each(?))
        ORDER BY ps.created_at ASC`,
      [proposalIdsJson],
    ),
  ]);

  const proposerByProposal = new Map(proposers.map((proposer) => [proposer.proposal_id, proposer]));
  const speakersByProposal = new Map<string, ProposalInvitePerson[]>();
  for (const speaker of speakers) {
    const lineup = speakersByProposal.get(speaker.proposal_id) ?? [];
    lineup.push(speaker);
    speakersByProposal.set(speaker.proposal_id, lineup);
  }

  return new Map(
    proposals.map((proposal) => [
      proposal.id,
      composeProposalInviteEmailContext(
        proposal,
        proposerByProposal.get(proposal.id) ?? null,
        speakersByProposal.get(proposal.id) ?? [],
      ),
    ]),
  );
}
