/**
 * Granting access that can widen anyone's access or change the platform is
 * never one click away. Every way of granting — a role, a single permission,
 * or a privileged permission added to a role people already hold — asks the
 * same question, in the same words, naming what the grant allows.
 */
import { confirmAction } from "../../../../components/ConfirmDialog";
import type { PickedUser } from "../../../../components/UserPicker";
import { PERMISSION_METADATA, privilegedPermissionsIn } from "../../../../../shared/permission-metadata";
import { TARGET_LABELS, type PickedTarget } from "./TargetPicker";

/** Where a grant applies, in words. */
function scopeOf(target: PickedTarget): string {
  if (!target.targetType) return "everywhere on the platform";
  const kind = TARGET_LABELS[target.targetType].toLowerCase();
  return target.targetName ? `for the ${kind} ${target.targetName}` : `for the selected ${kind}`;
}

/**
 * Resolves true straight away when `permissions` holds nothing privileged;
 * otherwise asks, and resolves the reader's answer.
 */
export async function confirmPrivilegedAccess({
  grant,
  permissions,
  user,
  target,
}: {
  /** What is being granted, as the title names it: `the "admin" role`. */
  grant: string;
  permissions: readonly string[];
  user: PickedUser;
  target: PickedTarget;
}): Promise<boolean> {
  const privileged = privilegedPermissionsIn(permissions);
  if (privileged.length === 0) return true;
  return confirmAction({
    title: `Give ${user.email} ${grant} ${scopeOf(target)}?`,
    body: `${user.email} will be able to:`,
    consequences: privileged.map((permission) => PERMISSION_METADATA[permission].label),
    confirmLabel: "Grant access",
  });
}

/**
 * A role's permissions apply to every assignment of it, so adding a
 * privileged permission to an existing role grants it to everyone who holds
 * that role. Resolves true straight away when nothing privileged is added.
 */
export async function confirmPrivilegedRoleChange({
  roleName,
  before,
  after,
}: {
  roleName: string;
  before: readonly string[];
  after: readonly string[];
}): Promise<boolean> {
  const kept = new Set(before);
  const added = privilegedPermissionsIn(after.filter((permission) => !kept.has(permission)));
  if (added.length === 0) return true;
  return confirmAction({
    title: `Add privileged access to the "${roleName}" role?`,
    body: "Everyone who holds this role, now and in future, will be able to:",
    consequences: added.map((permission) => PERMISSION_METADATA[permission].label),
    confirmLabel: "Add access",
  });
}
