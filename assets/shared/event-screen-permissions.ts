import type { Permission } from "./schemas/permissions";

/** Pairing, naming, assigning and revoking a screen. It never steers the program. */
export const SCREEN_MANAGE_PERMISSION = "agenda:screens_manage" as const satisfies Permission;

/**
 * Who may read a screen's status: the staff who manage screens, and the room
 * operators who watch them from the studio. Steering the program stays
 * `agenda:live_moderate` alone.
 */
export const SCREEN_STATUS_PERMISSIONS = [
  SCREEN_MANAGE_PERMISSION,
  "agenda:live_moderate",
] as const satisfies readonly [Permission, ...Permission[]];

export function canManageScreens(check: (permission: Permission) => boolean): boolean {
  return check(SCREEN_MANAGE_PERMISSION);
}

export function canReadScreenStatus(check: (permission: Permission) => boolean): boolean {
  return SCREEN_STATUS_PERMISSIONS.some((permission) => check(permission));
}
