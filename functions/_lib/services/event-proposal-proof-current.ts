import { first } from "../db/queries";
import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike } from "../types";
import { getRequiredTerms } from "./events";
import { prepareActiveTermsSnapshotGuard } from "./consent";
import {
  eventProposalProofRedemptionKey,
  proposalTermsDigest,
  type EventProposalProofPayload,
} from "./event-proposal-proof-capabilities";

/** A continuation authorizes only its original terms and an unconsumed, live proof. */
export async function prepareCurrentEventProposalProof(
  db: DatabaseLike,
  payload: EventProposalProofPayload & { expiresAt: number },
) {
  const key = eventProposalProofRedemptionKey(payload.capabilityId);
  if (await first(db, "SELECT id FROM audit_log WHERE idempotency_key=?", [key]))
    throw new AppError(409, "PROPOSAL_PROOF_USED", "This email confirmation has already submitted a proposal.");
  const terms = await getRequiredTerms(db, payload.eventId, "speaker");
  if ((await proposalTermsDigest(terms)) !== payload.termsDigest)
    throw new AppError(
      409,
      "PROPOSAL_TERMS_CHANGED",
      "The event terms changed. Review them and confirm your email again.",
      { consents: "Review the current event terms." },
    );
  return [
    prepareActiveTermsSnapshotGuard(db, payload.eventId, terms, "speaker"),
    prepareAuthorizationGuard(db, {
      sql: "SELECT 1 WHERE ? > unixepoch('now') AND NOT EXISTS(SELECT 1 FROM audit_log WHERE idempotency_key=?)",
      bindings: [payload.expiresAt, key],
    }),
  ];
}
export async function assertProposalProofCurrent(
  db: DatabaseLike,
  payload: EventProposalProofPayload & { expiresAt: number },
): Promise<void> {
  await prepareCurrentEventProposalProof(db, payload);
}
