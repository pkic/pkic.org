import { resolveEligibleMembershipRows } from "../../../auth/member";
import type { DatabaseLike } from "../../../types";
import { readEmailOwnership, provedMailboxUserId } from "../../email-ownership";

/**
 * Only recognized sign-in addresses may receive membership-specific guidance.
 * Any membership the person holds, through whichever identity, means they can
 * already sign in and choose it.
 */
export async function findExistingJoinMember(
  db: DatabaseLike,
  email: string,
): Promise<{ userId: string; memberId: string } | null> {
  const ownerId = provedMailboxUserId(await readEmailOwnership(db, email));
  if (!ownerId) return null;
  const [membership] = await resolveEligibleMembershipRows(db, ownerId);
  return membership ? { userId: membership.id, memberId: membership.member_id } : null;
}
