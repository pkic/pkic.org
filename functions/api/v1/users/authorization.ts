import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requireMemberFromRequest } from "../../../_lib/auth/member";
import { requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import type { DatabaseLike } from "../../../_lib/types";

/** Resolves an attributable staff identity for a canonical user route. */
export async function requireUserStaffPermission(c: AdminContext, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(staff, permission);
  return { db, staff };
}

/**
 * Who may read one user record.
 *
 * Two answers, and the first one is the reason this exists: the person the
 * record is about. A member holds no `users:read` — that permission is what
 * lets staff administer everybody — yet their own record is the page they
 * reach from "My profile", and refusing them their own name would be absurd.
 *
 * The second is staff holding `users:read`, unchanged. Answering "is this me"
 * here rather than loosening the permission keeps the administrative rule
 * exactly as narrow as it was: reading somebody else still takes the grant.
 */
export async function requireUserRecordReader(
  c: AdminContext,
  userId: string,
): Promise<{ db: DatabaseLike; isSelf: boolean }> {
  const db = requestDb(c);

  try {
    const member = await requireMemberFromRequest(db, c.req.raw, c.env);
    if (member.userId === userId) return { db, isSelf: true };
  } catch {
    // Not a member session. The staff attempt below produces the refusal a
    // caller sees, so an unauthenticated request still fails as it always did.
  }

  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  /*
   * A staff account with no membership still owns its own record, and reaches
   * it from the same menu item, so the self answer applies on this path too.
   *
   * Not for a delegated session, though. A scope-restricted actor is a client
   * a person handed a named subset of their authority to; "it is your own
   * record" is an argument about the person, and letting it stand here would
   * hand that client a read the delegation deliberately withheld.
   */
  if (staff.id === userId && !staff.scopeRestricted) return { db, isSelf: true };
  requirePermission(staff, "users:read");
  return { db, isSelf: false };
}
