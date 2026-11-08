import type { z } from "zod";
import type { memberJoinAffiliationPreviewSchema } from "../../../../../assets/shared/schemas/member-join";
import type { DatabaseLike } from "../../../types";
import { AppError } from "../../../errors";
import { verifyMemberJoinVerificationToken } from "./capabilities";
import { joinLinkConsumedSelection, prepareJoinAffiliationRead } from "./verification-read";
import { verifiedAffiliationPreview } from "../../identities/verified-affiliation-preview";
import { batchFirst } from "../../../db/pagination";

/** Mailbox proof authorizes observation, never a session or a consumed join link. */
export async function previewMemberJoinAffiliation(
  db: DatabaseLike,
  input: z.infer<typeof memberJoinAffiliationPreviewSchema> & { signingSecret: string },
) {
  const capability = await verifyMemberJoinVerificationToken(input.signingSecret, input.token);
  const consumed = joinLinkConsumedSelection(capability.capabilityId);
  const affiliation = prepareJoinAffiliationRead(db, capability.email, {
    domain: input.domain,
  });
  const results = await db.batch([
    db.prepare(consumed.sql).bind(...consumed.bindings),
    ...(affiliation?.statements ?? []),
  ]);
  if (batchFirst(results[0]))
    throw new AppError(409, "MEMBER_JOIN_LINK_USED", "Membership verification link already used");
  if (!affiliation) throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "Use a verified work email domain.");
  const observed = affiliation.decode(results.slice(1));
  return verifiedAffiliationPreview(observed.basis, observed.address);
}
