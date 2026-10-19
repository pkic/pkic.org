import { resolveEligibleMembershipRows } from "../../../auth/member";
import type { DatabaseLike } from "../../../types";
import { findUserEmailOwner } from "../../user-emails";

/**
 * Only recognized sign-in addresses may receive membership-specific guidance.
 * Any membership the person holds, through whichever identity, means they can
 * already sign in and choose it.
 */
export async function findExistingJoinMember(
  db: DatabaseLike,
  email: string,
): Promise<{ userId: string; memberId: string } | null> {
  const owner = await findUserEmailOwner(db, email);
  if (!owner || owner.kind === "pending" || (owner.kind === "secondary" && owner.verified !== 1)) return null;
  const [membership] = await resolveEligibleMembershipRows(db, owner.userId);
  return membership ? { userId: membership.id, memberId: membership.member_id } : null;
}
