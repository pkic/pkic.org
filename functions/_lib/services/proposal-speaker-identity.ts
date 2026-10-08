import { prepareAuthorizationGuard } from "../db/authorization-guard";
import { AppError } from "../errors";
import type { DatabaseLike, StatementLike } from "../types";
import { parseLinksJson } from "../../../assets/shared/schemas/links";
import {
  proposalActingIdentitySchema,
  proposalActingIdentitySnapshotSchema,
  type ProposalActingIdentitySnapshot,
} from "../../../assets/shared/schemas/proposal-acting-identity";
import { ownedIdentityAtEvidence, resolveOwnedIdentityAt } from "./identities/selection";
import type { UserProfilePatch } from "./users";

export interface ProposalActingIdentityRow {
  acting_identity_id: string | null;
  acting_identity_selected_at: string | null;
  acting_identity_snapshot_json: string | null;
}

export function proposalActingIdentityReadModel(
  row: Pick<ProposalActingIdentityRow, "acting_identity_id" | "acting_identity_selected_at">,
) {
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
  snapshot: ProposalActingIdentitySnapshot;
  guards: StatementLike[];
}

/** The aggregate caller supplies verified self authority and commits these guards in its batch. */
export async function prepareProposalActingIdentity(
  db: DatabaseLike,
  input: { userId: string; actingIdentityId: string | null; at: string; profile: UserProfilePatch },
): Promise<PreparedProposalActingIdentity> {
  if (input.actingIdentityId === null) {
    assertRepresentationFields(input.profile, { organizationName: null, jobTitle: null });
    return {
      identityId: null,
      selectedAt: input.at,
      snapshot: proposalActingIdentitySnapshotSchema.parse({
        organizationName: null,
        jobTitle: null,
        biography: input.profile.biography ?? null,
        links: parseLinksJson(input.profile.linksJson),
      }),
      guards: [],
    };
  }
  const identity = await resolveOwnedIdentityAt(db, {
    userId: input.userId,
    identityId: input.actingIdentityId,
    at: input.at,
  });
  assertRepresentationFields(input.profile, identity.snapshot);
  return {
    identityId: identity.id,
    selectedAt: input.at,
    snapshot: identity.snapshot,
    guards: [
      prepareAuthorizationGuard(
        db,
        ownedIdentityAtEvidence({
          userId: input.userId,
          identityId: identity.id,
          at: input.at,
          expectedUpdatedAt: identity.updatedAt,
          organizationName: identity.snapshot.organizationName,
        }),
      ),
    ],
  };
}

export function assertRepresentationFields(
  profile: UserProfilePatch,
  snapshot: Pick<ProposalActingIdentitySnapshot, "organizationName" | "jobTitle">,
) {
  for (const key of ["organizationName", "jobTitle"] as const) {
    const value = profile[key];
    if (value !== undefined && value !== null && value !== "" && value !== snapshot[key]) {
      throw new AppError(
        422,
        "PROPOSAL_IDENTITY_PROFILE_CONFLICT",
        "The organization and job title must match the selected representation.",
        { [key]: "Use the selected identity's details." },
      );
    }
  }
}
