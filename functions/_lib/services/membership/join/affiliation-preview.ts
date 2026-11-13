import type { z } from "zod";
import type { memberJoinAffiliationPreviewSchema } from "../../../../../assets/shared/schemas/member-join";
import type { DatabaseLike } from "../../../types";
import { AppError } from "../../../errors";
import { prepareJoinAffiliationRead } from "./verification-read";
import { verifiedAffiliationPreview } from "../../identities/verified-affiliation-preview";

/** The signed-in account's proved address authorizes observation only; nothing is written. */
export async function previewMemberJoinAffiliation(
  db: DatabaseLike,
  input: z.infer<typeof memberJoinAffiliationPreviewSchema> & { email: string },
) {
  const affiliation = prepareJoinAffiliationRead(db, input.email, { domain: input.domain });
  if (!affiliation) throw new AppError(422, "IDENTITY_DOMAIN_MISMATCH", "Use a verified work email domain.");
  const observed = affiliation.decode(await db.batch(affiliation.statements));
  return verifiedAffiliationPreview(observed.basis, observed.address);
}
