import type { IndependentCapacityDisclosure } from "../../../assets/shared/schemas/independent-capacity";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import {
  prepareIndependentDisclosure,
  prepareSupersedeIndependentDisclosure,
  requireIndependentDisclosure,
} from "./proposal-speaker-independent-disclosure";

/** A selection must take the capacity its confirmed mailbox proved: individual or organization. */
export function assertProvedCapacity(
  applicantKind: "individual" | "organization" | undefined,
  payload: { unaffiliatedAttestation?: boolean; actingIdentityId?: string | null },
): void {
  if (!applicantKind) return;
  if (
    payload.unaffiliatedAttestation !== undefined &&
    payload.unaffiliatedAttestation !== (applicantKind === "individual")
  )
    throw new AppError(422, "PROPOSAL_QUALIFICATION_CHANGED", "Confirm the selected affiliation again.");
  if (applicantKind === "individual" && payload.actingIdentityId != null)
    throw new AppError(
      422,
      "PROPOSAL_QUALIFICATION_CHANGED",
      "An individual presentation cannot select an organization identity.",
    );
  if (applicantKind === "organization" && payload.actingIdentityId === null)
    throw new AppError(422, "PROPOSAL_QUALIFICATION_CHANGED", "Choose the confirmed organization affiliation.");
}

/**
 * Taking part as an individual records the independence disclosure;
 * acting for an organization retires any earlier one.
 */
export function prepareSelectedCapacityDisclosure(
  db: DatabaseLike,
  input: {
    identityId: string | null;
    proposalId: string;
    proposalSpeakerId: string;
    userId: string;
    email: string;
    disclosure: IndependentCapacityDisclosure | undefined;
    at: string;
  },
): StatementLike[] {
  if (input.identityId !== null) return [prepareSupersedeIndependentDisclosure(db, input.proposalSpeakerId, input.at)];
  return prepareIndependentDisclosure(db, {
    ...input,
    disclosure: requireIndependentDisclosure(input.disclosure),
    actor: { type: "user", id: input.userId },
  });
}
