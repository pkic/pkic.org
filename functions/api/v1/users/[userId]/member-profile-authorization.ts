/**
 * Who may read another member's community profile.
 *
 * The consortium's profiles are an internal directory: one member can see
 * another. That is a different question from "may this person administer
 * users", so these routes do not require staff `users:read` — a signed-in
 * member is authorized, and staff are authorized too because a staff session
 * is not a lesser one.
 *
 * The distinction matters most for vouching. A vouch is a member's judgement
 * about a peer; requiring staff permission to give one would mean only
 * administrators could vouch, which empties the gesture of its meaning.
 *
 * Nothing here is public. Both paths demand an authenticated session, and the
 * read models still apply their own rules on top — availability honours its
 * audience setting, and a ballot's choice honours the vote's.
 */
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { requireMemberFromRequest } from "../../../../_lib/auth/member";
import { hasPermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { AppError } from "../../../../_lib/errors";
import type { DatabaseLike } from "../../../../_lib/types";

export interface ProfileReader {
  db: DatabaseLike;
  /**
   * The reader's own user id, or null for a caller with no member identity of
   * its own — a service token. Used to mark their vouches, never to widen what
   * they can see.
   */
  viewerUserId: string | null;
  /** Whether the reader holds staff authority over user records. */
  isStaff: boolean;
}

/**
 * Resolves a reader for a community-profile route.
 *
 * Tries the member session first because that is the common case and the one
 * the surface exists for; falls back to a staff identity so an administrator
 * without an active membership can still open a record.
 */
export async function requireProfileReader(c: AdminContext): Promise<ProfileReader> {
  const db = requestDb(c);

  try {
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    return { db, viewerUserId: member.userId, isStaff: false };
  } catch {
    // Not a member session — fall through to staff. The staff attempt below
    // is what produces the refusal a caller sees, so an unauthenticated
    // request still fails with the ordinary authorization error.
  }

  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  if (!hasPermission(staff, "users:read")) {
    throw new AppError(403, "AUTH_FORBIDDEN", "Membership or users:read is required to view a member profile.");
  }
  return { db, viewerUserId: staff.identityType === "user" ? staff.id : null, isStaff: true };
}

/**
 * A reader who may give or withdraw a vouch.
 *
 * Only a member can: a vouch says "I have worked with this person", and a
 * service token or an administrator acting outside their own membership has no
 * such judgement to record.
 */
export async function requireVouchingMember(c: AdminContext): Promise<{ db: DatabaseLike; voucherUserId: string }> {
  const db = requestDb(c);
  const member = await requireMemberFromRequest(db, c.req.raw, c.env);
  return { db, voucherUserId: member.userId };
}
