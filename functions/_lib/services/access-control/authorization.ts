import {
  hasPermission,
  preparePermissionsAuthorizationGuard,
  requirePermission,
  type PermissionRequirement,
} from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { AppError } from "../../errors";
import type { AuthAdmin, DatabaseLike, StatementLike } from "../../types";
import { isAuditChangeGuardFailure } from "../audit";

/** Permit access-control catalog reads to operators who can either grant or revoke. */
export function requireAccessControlRead(actor: AuthAdmin): void {
  if (!hasPermission(actor, "access:grant") && !hasPermission(actor, "access:revoke")) {
    requirePermission(actor, "access:grant");
  }
}

/** Commits an RBAC mutation only while every preflight permission remains live. */
export async function commitAccessControlMutation(
  db: DatabaseLike,
  actor: AuthAdmin,
  requirements: readonly PermissionRequirement[],
  statements: readonly StatementLike[],
): Promise<void> {
  try {
    await db.batch([preparePermissionsAuthorizationGuard(db, actor, requirements), ...statements]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error)) {
      throw new AppError(
        409,
        "ACCESS_CONTROL_AUTHORIZATION_CHANGED",
        "Access-control authority changed while the update was being saved",
      );
    }
    if (isAuditChangeGuardFailure(error)) {
      throw new AppError(
        409,
        "ACCESS_CONTROL_TARGET_CHANGED",
        "The access-control target changed while the update was being saved",
      );
    }
    throw error;
  }
}
