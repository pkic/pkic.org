/**
 * Ends one organization representation on a person's record, through the
 * contract that fits who is ending it.
 *
 * The person ends their own through the current-user identity route, even
 * when they also hold staff permissions: nobody administers themselves. Staff
 * end someone else's through the organization's identity route, which records
 * why.
 */
import { identityMutationResponseSchema } from "../../../../../shared/schemas/identity";
import { patchJson } from "../../../../shared/api-client";
import { CURRENT_USER_API } from "./current-user-api";
import type { UserMembership } from "./model";

export async function endRepresentation(
  membership: Pick<UserMembership, "identityId" | "organizationId">,
  viewerIsSubject: boolean,
  endedAt: string | undefined,
): Promise<void> {
  const identityId = encodeURIComponent(membership.identityId);
  if (viewerIsSubject) {
    await patchJson(
      `${CURRENT_USER_API}/identities/${identityId}`,
      { transition: { state: "ended", ...(endedAt ? { endedAt } : {}) } },
      identityMutationResponseSchema,
    );
    return;
  }
  await patchJson(
    `/api/v1/organizations/${encodeURIComponent(membership.organizationId ?? "")}/identities/${identityId}`,
    { transition: { state: "ended", reason: "Ended from System Users", ...(endedAt ? { endedAt } : {}) } },
    identityMutationResponseSchema,
  );
}
