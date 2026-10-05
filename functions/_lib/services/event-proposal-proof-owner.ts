import type { AuthenticatedIdentity } from "../auth/user-session";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { prepareCurrentEventProposalProof } from "./event-proposal-proof-current";
import { prepareEventProposalProofContext } from "./event-proposal-proof-context";
import { prepareEventProposalEntry } from "./event-proposal-proof-entry";
import { prepareProposalProofPerson } from "./event-proposal-proof-person";
import { verifyEventProposalCapability } from "./event-proposal-proof-capabilities";
import { getSpeakerByManageToken } from "./proposals";
import { prepareSpeakerSelfAuthorityGuard } from "./proposals-speaker-profile";

/** A current human session or exact verified capability identifies one owner; neither grants organization management. */
export async function prepareEventProposalPersonOwner(
  db: DatabaseLike,
  input: {
    eventId: string;
    signingSecret: string;
    at: string;
    continuationToken?: string;
    speakerManagementToken?: string;
    actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
  },
) {
  const guards: StatementLike[] = [];
  let userId = input.actor?.userId;
  let proofEmail: string | undefined;
  let speakerId: string | undefined;
  if (input.speakerManagementToken) {
    const { speaker, proposal } = await getSpeakerByManageToken(db, input.speakerManagementToken, input.signingSecret);
    if (proposal.event_id !== input.eventId || (userId && userId !== speaker.user_id))
      throw new AppError(403, "PROPOSAL_PERSON_MISMATCH", "Use your own speaker invitation.");
    userId = speaker.user_id;
    speakerId = speaker.id;
    guards.push(
      prepareSpeakerSelfAuthorityGuard(db, input.speakerManagementToken, {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        userId: speaker.user_id,
        inviteGeneration: speaker.invite_generation,
        expectedManageLinkSecret: speaker.manage_link_secret,
      }),
    );
  }
  if (input.continuationToken) {
    const payload = await verifyEventProposalCapability(
      input.signingSecret,
      input.continuationToken,
      input.eventId,
      true,
    );
    if (!payload.userId || (userId && userId !== payload.userId))
      throw new AppError(403, "PROPOSAL_PERSON_MISMATCH", "Edit only your own confirmed personal details.");
    guards.push(
      ...(await prepareCurrentEventProposalProof(db, payload)),
      ...(await prepareEventProposalProofContext(db, {
        payload,
        signingSecret: input.signingSecret,
        actor: input.actor,
        operation: input.speakerManagementToken ? "speaker_profile" : "proposal_submission",
        speakerId,
        speakerAuthority: input.speakerManagementToken,
      })),
      ...(await prepareEventProposalEntry(db, input.eventId, payload.entryContext)).statements,
    );
    const person = await prepareProposalProofPerson(db, payload, { email: payload.email }, input.at);
    guards.push(...person.statements);
    userId = person.user.id;
    proofEmail = payload.email;
  }
  if (!userId) throw new AppError(401, "AUTH_REQUIRED", "Confirm your email or sign in to edit your details.");
  if (input.actor)
    guards.push(
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        bindings: [input.actor.sessionId, userId],
      }),
    );
  return { userId, guards, proofEmail };
}
