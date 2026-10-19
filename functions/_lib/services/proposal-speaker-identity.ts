import { prepareAuthorizationGuard } from "../db/authorization-guard";
import type { DatabaseLike, StatementLike } from "../types";
import { proposalActingIdentitySchema } from "../../../assets/shared/schemas/proposal-acting-identity";
import { ownedIdentityAtEvidence, resolveOwnedIdentityAt, type IdentityRepresentation } from "./identities/selection";
import { AppError } from "../errors";
import { JOB_TITLE_REQUIRED } from "../../../assets/shared/schemas/api-common";
import { prepareIndividualIdentityStatement } from "./users";

/** The speaker's choice of identity on one proposal: which one, and when. Nothing of the identity is copied. */
export interface ProposalActingIdentityRow {
  acting_identity_id: string | null;
  acting_identity_selected_at: string | null;
}

export function proposalActingIdentityReadModel(row: ProposalActingIdentityRow) {
  return proposalActingIdentitySchema.parse({
    actingIdentityId: row.acting_identity_id ?? null,
    actingIdentitySelectedAt: row.acting_identity_selected_at ?? null,
    actingIdentitySelection: row.acting_identity_selected_at
      ? row.acting_identity_id
        ? "identity"
        : "individual"
      : "unrecorded",
  });
}

export interface PreparedProposalActingIdentity {
  identityId: string | null;
  selectedAt: string;
  /** What the chosen identity represents now, for the checks and messages of this write; never stored. */
  representation: IdentityRepresentation;
  guards: StatementLike[];
}

/** The aggregate caller supplies verified self authority and commits these guards in its batch. */
export async function prepareProposalActingIdentity(
  db: DatabaseLike,
  input: {
    userId: string;
    actingIdentityId: string | null;
    at: string;
    /** The request field a representation without a job title is refused on, when the caller selects one. */
    jobTitleField?: string;
  },
): Promise<PreparedProposalActingIdentity> {
  if (input.actingIdentityId === null) {
    return {
      identityId: null,
      selectedAt: input.at,
      representation: { organizationName: null, jobTitle: null },
      // Taking part as an individual speaks as the person's individual identity, which holds their
      // profile; someone who only held organization identities receives one in the same batch.
      guards: [prepareIndividualIdentityStatement(db, input.userId, input.at)],
    };
  }
  const identity = await resolveOwnedIdentityAt(db, {
    userId: input.userId,
    identityId: input.actingIdentityId,
    at: input.at,
  });
  if (input.jobTitleField) requireRepresentationJobTitle(identity.representation, input.jobTitleField);
  return {
    identityId: identity.id,
    selectedAt: input.at,
    representation: identity.representation,
    guards: [
      prepareAuthorizationGuard(
        db,
        ownedIdentityAtEvidence({
          userId: input.userId,
          identityId: identity.id,
          at: input.at,
          expectedUpdatedAt: identity.updatedAt,
          organizationName: identity.representation.organizationName,
        }),
      ),
    ],
  };
}

/**
 * Taking part on behalf of an organization requires a job title. A chosen
 * representation carries its own, so one without a title is refused on the
 * field that asks for it; the committed guard pins the representation read here.
 */
function requireRepresentationJobTitle(representation: IdentityRepresentation, field: string): void {
  if (representation.organizationName && !representation.jobTitle?.trim())
    throw new AppError(422, "REPRESENTATION_JOB_TITLE_REQUIRED", JOB_TITLE_REQUIRED, {
      fieldErrors: { [field]: [JOB_TITLE_REQUIRED] },
    });
}
