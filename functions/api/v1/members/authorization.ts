import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../_lib/auth/admin";
import { requirePermission } from "../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../_lib/db/context";
import { hasAuthenticatedSessionCookie } from "../../../_lib/auth/session-cookies";
import { AppError } from "../../../_lib/errors";

/** Resolves an attributable staff identity for canonical membership routes. */
export async function requireMembershipStaffPermission(c: AdminContext, permission: Permission) {
  const db = requestDb(c);
  const staff = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  requirePermission(staff, permission);
  return { db, staff };
}

/**
 * The staff reader behind this request, when there is one.
 *
 * A directory listing is readable by anybody, and richer for somebody who may
 * see standing — so the absence of a staff identity is an ordinary outcome
 * here rather than a refusal. Only an outright authorization failure is
 * swallowed: anything else (a dead database, a malformed token the resolver
 * itself objects to) still reaches the caller.
 */
export async function optionalMembershipReader(
  c: AdminContext,
): Promise<Awaited<ReturnType<typeof requireMembershipStaffPermission>> | null> {
  if (!hasAuthenticatedSessionCookie(c.req.raw) && !c.req.raw.headers.get("authorization")) return null;
  try {
    return await requireMembershipStaffPermission(c, "membership:read");
  } catch (error) {
    if (error instanceof AppError && (error.status === 401 || error.status === 403)) return null;
    throw error;
  }
}
