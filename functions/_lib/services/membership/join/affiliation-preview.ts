import type { z } from "zod";
import type { memberJoinAffiliationPreviewSchema } from "../../../../../assets/shared/schemas/member-join";
import type { DatabaseLike } from "../../../types";
import { AppError } from "../../../errors";
import { verifyMemberJoinVerificationToken } from "./capabilities";
import { readJoinVerification } from "./verification-read";
import { verifiedAffiliationPreview } from "../../identities/verified-affiliation-preview";

/** Mailbox proof authorizes observation, never a session or a consumed join link. */
export async function previewMemberJoinAffiliation(
  db: DatabaseLike,
  input: z.infer<typeof memberJoinAffiliationPreviewSchema> & { signingSecret: string },
) {
  const capability = await verifyMemberJoinVerificationToken(input.signingSecret, input.token);
  const observed = await readJoinVerification(db, capability.email, capability.capabilityId, undefined, input);
  if (observed.consumed) throw new AppError(409, "MEMBER_JOIN_LINK_USED", "Membership verification link already used");
  if (!observed.affiliation) throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "Use a verified work email domain.");
  return verifiedAffiliationPreview(observed.affiliation.basis, observed.affiliation.address);
}
