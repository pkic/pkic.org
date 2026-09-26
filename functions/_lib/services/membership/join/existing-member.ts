import { findEligibleMemberById } from "../../../auth/member";
import type { DatabaseLike } from "../../../types";
import { findUserEmailOwner } from "../../user-emails";

/** Only recognized sign-in addresses may receive membership-specific guidance. */
export async function findExistingJoinMember(db: DatabaseLike, email: string) {
  const owner = await findUserEmailOwner(db, email);
  if (!owner || owner.kind === "pending" || (owner.kind === "secondary" && owner.verified !== 1)) return null;
  return findEligibleMemberById(db, owner.userId);
}
