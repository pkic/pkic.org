import type { AuthenticatedIdentity } from "../auth/user-session";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { eventProposalSpeakerAuthority } from "./event-proposal-proof-context";
import { getSpeakerByManageToken } from "./proposals";
import { prepareSpeakerSelfAuthorityGuard } from "./proposals-speaker-profile";

/** The current session identifies the owner; a speaker link narrows it to that speaker and grants no organization management. */
export async function prepareEventProposalPersonOwner(
  db: DatabaseLike,
  input: {
    eventId: string;
    signingSecret: string;
    speakerManagementToken?: string;
    speakerProposalId?: string;
    actor: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
  },
) {
  const guards: StatementLike[] = [];
  const userId = input.actor.userId;
  const authority = eventProposalSpeakerAuthority(input);
  if (authority) {
    const { speaker, proposal } = await getSpeakerByManageToken(db, authority, input.signingSecret);
    if (proposal.event_id !== input.eventId || userId !== speaker.user_id)
      throw new AppError(403, "PROPOSAL_PERSON_MISMATCH", "Use your own speaker invitation.");
    guards.push(
      prepareSpeakerSelfAuthorityGuard(db, authority, {
        proposalSpeakerId: speaker.id,
        proposalId: proposal.id,
        userId: speaker.user_id,
        inviteGeneration: speaker.invite_generation,
        expectedManageLinkSecret: speaker.manage_link_secret,
      }),
    );
  }
  guards.push(
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 FROM sessions WHERE id=? AND user_id=? AND revoked_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",
      bindings: [input.actor.sessionId, userId],
    }),
  );
  return { userId, guards };
}
