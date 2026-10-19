/**
 * Reinstates one ended organization representation on a person's record,
 * through the contract that fits who is asking.
 *
 * The owner can't reinstate directly: the current-user route sends a link to
 * the identity's address, and following it reinstates. Staff reinstate
 * someone else's through the organization's identity route, which records why.
 */
import {
  identityMutationResponseSchema,
  identityReinstatementRequestResponseSchema,
} from "../../../../../shared/schemas/identity";
import { patchJson, postJson } from "../../../../shared/api-client";
import { CURRENT_USER_API } from "./current-user-api";
import type { UserDetail } from "./model";

type FormerIdentity = UserDetail["formerIdentities"][number];

/** Returns where the link went (the owner), or that the identity was reinstated. */
export async function reinstateRepresentation(
  identity: Pick<FormerIdentity, "identityId" | "organizationId">,
  viewerIsSubject: boolean,
): Promise<{ linkSentTo: string } | "reinstated"> {
  const identityId = encodeURIComponent(identity.identityId);
  if (viewerIsSubject) {
    const sent = await postJson(
      `${CURRENT_USER_API}/identities/${identityId}/reinstatement`,
      {},
      identityReinstatementRequestResponseSchema,
    );
    return { linkSentTo: sent.recipientEmail };
  }
  await patchJson(
    `/api/v1/organizations/${encodeURIComponent(identity.organizationId ?? "")}/identities/${identityId}`,
    { transition: { state: "active", reason: "Reinstated from System Users" } },
    identityMutationResponseSchema,
  );
  return "reinstated";
}
