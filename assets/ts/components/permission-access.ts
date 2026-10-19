/**
 * Read and write access in a permission matrix, for one area or for all of
 * them. Each is read off the ticked permissions rather than stored beside
 * them, so the permissions stay the one truth; a partly ticked kind reads as
 * custom.
 */
export type Access = "read" | "write";

export interface LeveledPermission {
  permission: string;
  access: Access;
}

/** Whether all, some, or none of these permissions of one kind are ticked; "unavailable" when there are none of that kind. */
export function accessState(
  permissions: readonly LeveledPermission[],
  access: Access,
  selected: ReadonlySet<string>,
): "all" | "some" | "none" | "unavailable" {
  const ofKind = permissions.filter((item) => item.access === access);
  if (ofKind.length === 0) return "unavailable";
  const ticked = ofKind.filter((item) => selected.has(item.permission)).length;
  return ticked === ofKind.length ? "all" : ticked === 0 ? "none" : "some";
}

/** Whether any kind is only partly ticked, so the area reads as custom. */
export function isCustom(permissions: readonly LeveledPermission[], selected: ReadonlySet<string>): boolean {
  return (["read", "write"] as const).some((access) => accessState(permissions, access, selected) === "some");
}

/** Whether a column stands for more than one permission, so the area needs its list to make an exception. */
export function hasSeveralOfOneAccess(permissions: readonly LeveledPermission[]): boolean {
  return (["read", "write"] as const).some((access) => permissions.filter((item) => item.access === access).length > 1);
}

/** The selection with every permission of one kind ticked or cleared, the rest left as it was. */
export function withAccess(
  selected: ReadonlySet<string>,
  permissions: readonly LeveledPermission[],
  access: Access,
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const item of permissions) {
    if (item.access !== access) continue;
    if (on) next.add(item.permission);
    else next.delete(item.permission);
  }
  return next;
}
