import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/links";
import { first } from "../db/queries";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { prepareAuditLog } from "./audit";
import { buildUpdateProposalSpeakerRoleStatements } from "./proposal-speakers";
import { prepareSpeakerProfileStatement } from "./proposals-speaker-profile";
import { getProposalByManageToken, type ProposalRecord } from "./proposals";

export interface ProposerManagedSpeaker {
  id: string;
  user_id: string;
  role: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  biography: string | null;
  links_json: string | null;
  headshot_r2_key: string | null;
}

export interface ProposerSpeakerProfilePatch {
  role?: string;
  firstName?: string | null;
  lastName?: string | null;
  organizationName?: string | null;
  jobTitle?: string | null;
  biography?: string | null;
  links?: string[];
}

export async function getProposerManagedSpeakerContext(
  db: DatabaseLike,
  manageToken: string,
  userId: string,
  signingSecret: string,
): Promise<{ proposal: ProposalRecord; speaker: ProposerManagedSpeaker & { status: string } }> {
  const proposal = await getProposalByManageToken(db, manageToken, signingSecret);
  const speaker = await first<ProposerManagedSpeaker & { status: string }>(
    db,
    `SELECT ps.id, ps.user_id, ps.status, ps.role,
            u.first_name, u.last_name, u.organization_name, u.job_title, u.biography, u.links_json,
            u.headshot_r2_key
       FROM proposal_speakers ps
       JOIN users u ON u.id = ps.user_id
      WHERE ps.proposal_id = ? AND ps.user_id = ?`,
    [proposal.id, userId],
  );
  if (!speaker) throw new AppError(404, "SPEAKER_NOT_FOUND", "Speaker not found on this proposal");
  if (proposal.status === "withdrawn" || proposal.status === "rejected") {
    throw new AppError(400, "PROPOSAL_CLOSED", "Cannot update speakers on a closed proposal");
  }
  return { proposal, speaker };
}

export async function updateProposalSpeakerByProposer(
  db: DatabaseLike,
  payload: {
    proposal: ProposalRecord;
    speaker: ProposerManagedSpeaker;
    patch: ProposerSpeakerProfilePatch;
  },
): Promise<boolean> {
  const statements: StatementLike[] = [];
  const details: Record<string, { from: unknown; to: unknown }> = {};
  const profilePatch: Omit<ProposerSpeakerProfilePatch, "role" | "links"> & { linksJson?: string | null } = {};

  for (const key of ["firstName", "lastName", "organizationName", "jobTitle", "biography"] as const) {
    if (payload.patch[key] !== undefined) {
      profilePatch[key] = payload.patch[key] ?? null;
      const databaseKey = {
        firstName: "first_name",
        lastName: "last_name",
        organizationName: "organization_name",
        jobTitle: "job_title",
        biography: "biography",
      }[key] as "first_name" | "last_name" | "organization_name" | "job_title" | "biography";
      details[key] = { from: payload.speaker[databaseKey], to: payload.patch[key] ?? null };
    }
  }
  if (payload.patch.links !== undefined) {
    profilePatch.linksJson = serializeLinks(payload.patch.links);
    details.links = { from: parseLinksJson(payload.speaker.links_json), to: payload.patch.links };
  }
  if (Object.keys(profilePatch).length > 0) {
    statements.push(prepareSpeakerProfileStatement(db, payload.speaker.user_id, profilePatch));
  }
  if (payload.patch.role !== undefined && payload.patch.role !== payload.speaker.role) {
    statements.push(
      ...(await buildUpdateProposalSpeakerRoleStatements(db, {
        proposalId: payload.proposal.id,
        userId: payload.speaker.user_id,
        role: payload.patch.role,
      })),
    );
    details.role = { from: payload.speaker.role, to: payload.patch.role };
  }
  if (statements.length === 0) return false;

  statements.push(
    prepareAuditLog(
      db,
      "user",
      payload.proposal.proposer_user_id,
      "speaker_profile_updated_by_proposer",
      "proposal_speaker",
      payload.speaker.id,
      { proposalId: payload.proposal.id, speakerUserId: payload.speaker.user_id, ...details },
    ),
  );
  await db.batch(statements);
  return true;
}
