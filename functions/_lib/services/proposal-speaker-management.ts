import { prepareQueueEmailStatement } from "../email/outbox";
import { parseLinksJson, serializeLinks } from "../../../assets/shared/schemas/links";
import type { DatabaseLike, StatementLike } from "../types";
import type { EventRecord } from "./events";
import { buildEventEmailVariables } from "./events";
import { speakerManagePageUrl } from "./frontend-links";
import { prepareAuditLog } from "./audit";
import {
  buildAddProposalSpeaker,
  buildProposalInviteEmailContext,
  buildUpdateProposalSpeakerRoleStatements,
  formatInvitePerson,
} from "./proposal-speakers";
import { prepareSpeakerProfileStatement } from "./proposals-speaker-profile";
import type { ProposalRecord } from "./proposals";
import { buildFindOrCreateUserStatement } from "./users";
import { sha256Hex } from "../utils/crypto";
import { first } from "../db/queries";
import { AppError } from "../errors";
import { getProposalByManageToken } from "./proposals";

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
            u.first_name, u.last_name, u.organization_name, u.job_title, u.biography, u.links_json
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

async function inviteProposalSpeakerOnce(
  db: DatabaseLike,
  payload: {
    proposal: ProposalRecord;
    event: EventRecord;
    appBaseUrl: string;
    email: string;
    firstName?: string;
    lastName?: string;
    role: string;
  },
): Promise<{ email: string; outboxId: string }> {
  const preparedUser = await buildFindOrCreateUserStatement(db, {
    email: payload.email,
    firstName: payload.firstName,
    lastName: payload.lastName,
  });
  const preparedSpeaker = await buildAddProposalSpeaker(db, {
    proposalId: payload.proposal.id,
    userId: preparedUser.user.id,
    role: payload.role,
    proposalContext: { event_id: payload.proposal.event_id, status: payload.proposal.status },
  });
  const context = await buildProposalInviteEmailContext(db, {
    proposalId: payload.proposal.id,
    inviterUserId: payload.proposal.proposer_user_id,
  });
  const pendingLine = `- ${formatInvitePerson(
    preparedUser.user.first_name,
    preparedUser.user.last_name,
    preparedUser.user.organization_name,
    preparedUser.user.email,
  )}`;
  const speakerLineupText = preparedSpeaker.alreadyPresent
    ? context.speakerLineupText
    : [context.speakerLineupText, pendingLine].filter(Boolean).join("\n");
  const manageUrl = speakerManagePageUrl(payload.appBaseUrl, payload.event, preparedSpeaker.manageToken);
  const idempotencyKey = `proposal_speaker_invite:${preparedSpeaker.speakerId}:${preparedSpeaker.inviteGeneration}`;
  const queued = prepareQueueEmailStatement(db, {
    outboxId: (await sha256Hex(idempotencyKey)).slice(0, 32),
    idempotencyKey,
    eventId: payload.event.id,
    baseUrl: payload.appBaseUrl,
    templateKey: "co_speaker_invite",
    recipientEmail: preparedUser.user.email,
    recipientUserId: preparedUser.user.id,
    messageType: "transactional",
    subject: `You have been added as a speaker — ${payload.event.name}`,
    capabilityLinkValues: [manageUrl],
    data: {
      ...buildEventEmailVariables(payload.event, payload.appBaseUrl),
      firstName: preparedUser.user.first_name ?? "",
      lastName: preparedUser.user.last_name ?? "",
      proposerFirstName: context.inviterFirstName ?? "",
      invitedByDisplay: context.invitedByDisplay,
      proposalTitle: context.proposalTitle,
      proposalAbstract: context.proposalAbstract,
      speakerLineupText,
      manageUrl,
    },
  });

  const statements: StatementLike[] = [];
  if (preparedUser.statement) statements.push(preparedUser.statement);
  statements.push(
    ...preparedSpeaker.statements,
    queued.statement,
    prepareAuditLog(
      db,
      "user",
      payload.proposal.proposer_user_id,
      "co_speaker_invited",
      "proposal_speaker",
      preparedSpeaker.speakerId,
      {
        proposalId: payload.proposal.id,
        speakerUserId: preparedUser.user.id,
        email: preparedUser.user.email,
        role: payload.role,
      },
      undefined,
      idempotencyKey,
    ),
  );
  await db.batch(statements);
  return { email: preparedUser.user.email, outboxId: queued.id };
}

export async function inviteProposalSpeaker(
  db: DatabaseLike,
  payload: Parameters<typeof inviteProposalSpeakerOnce>[1],
): Promise<{ email: string; outboxId: string }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await inviteProposalSpeakerOnce(db, payload);
    } catch (error) {
      const concurrentUserInsert =
        error instanceof Error && error.message.includes("UNIQUE constraint failed: users.normalized_email");
      if (!concurrentUserInsert || attempt === 2) throw error;
    }
  }
  throw new Error("Speaker invitation could not be committed after concurrent user creation");
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
