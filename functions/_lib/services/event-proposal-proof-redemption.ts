import type { AuthenticatedIdentity } from "../auth/user-session";
import type { DatabaseLike } from "../types";
import { AppError } from "../errors";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { prepareOneTimeAuditLog } from "./audit";
import type { FindOrCreateUserPayload } from "./users";
import type { ParticipantAuthority } from "./participant-authority";
import { getRequiredTerms } from "./events";
import { prepareActiveTermsSnapshotGuard } from "./consent";
import { prepareProposalProofPerson } from "./event-proposal-proof-person";
import { prepareEventProposalProofContext } from "./event-proposal-proof-context";
import {
  eventProposalProofRedemptionKey,
  proposalTermsDigest,
  verifyEventProposalCapability,
  type EventProposalProofPayload,
} from "./event-proposal-proof-capabilities";
import { first } from "../db/queries";
import { prepareEventProposalEntry } from "./event-proposal-proof-entry";

export function isEventProposalProofReplay(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.message.includes("uq_audit_log_idempotency_key") || error.message.includes("audit_log.idempotency_key"))
  );
}
export function eventProposalProofReplayError(): AppError {
  return new AppError(409, "PROPOSAL_PROOF_USED", "This email confirmation has already been used.");
}
export async function prepareEventProposalProofRedemption(
  db: DatabaseLike,
  input: {
    eventId: string;
    continuationToken: string;
    signingSecret: string;
    at: string;
    operation: EventProposalProofPayload["operation"];
    actor?: Pick<AuthenticatedIdentity, "userId" | "sessionId">;
    speakerAuthority?: ParticipantAuthority;
    speakerId?: string;
    profile?: FindOrCreateUserPayload;
  },
) {
  const payload = await verifyEventProposalCapability(
    input.signingSecret,
    input.continuationToken,
    input.eventId,
    true,
  );
  const contextGuards = await prepareEventProposalProofContext(db, { ...input, payload });
  const entry = await prepareEventProposalEntry(db, input.eventId, payload.entryContext);
  if (
    await first(db, "SELECT id FROM audit_log WHERE idempotency_key=?", [
      eventProposalProofRedemptionKey(payload.capabilityId),
    ])
  )
    throw eventProposalProofReplayError();
  const audience = "speaker";
  const terms = await getRequiredTerms(db, payload.eventId, audience);
  if ((await proposalTermsDigest(terms)) !== payload.termsDigest)
    throw new AppError(
      409,
      "PROPOSAL_TERMS_CHANGED",
      "The event terms changed. Review them and confirm your email again.",
      { consents: "Review the current event terms." },
    );
  const person = await prepareProposalProofPerson(db, payload, input.profile ?? { email: payload.email }, input.at);
  const proofKey = eventProposalProofRedemptionKey(payload.capabilityId);
  const proofEvidence = {
    sql: "SELECT 1 FROM audit_log WHERE idempotency_key=? AND actor_id=?",
    bindings: [proofKey, person.user.id],
  };
  return {
    ...person,
    normalizedEmail: payload.email,
    applicantKind: payload.applicantKind,
    terms,
    proofEvidence,
    entryContext: payload.entryContext,
    statements: [
      ...contextGuards,
      ...entry.statements,
      prepareActiveTermsSnapshotGuard(db, input.eventId, terms, audience),
      prepareAuthorizationGuard(db, {
        sql: "SELECT 1 WHERE CAST(strftime('%s','now') AS INTEGER) < ?",
        bindings: [payload.expiresAt],
      }),
      prepareOneTimeAuditLog(
        db,
        "user",
        person.user.id,
        "event_mailbox_confirmed",
        "event",
        input.eventId,
        { email: payload.email, applicantKind: payload.applicantKind, operation: payload.operation },
        input.at,
        proofKey,
        { type: "event", id: input.eventId },
      ),
      ...person.statements,
    ],
  };
}
