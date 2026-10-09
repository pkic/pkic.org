import { z } from "zod";
import { PERMISSION_METADATA } from "./permission-metadata";

/** Canonical permission vocabulary shared by the Worker and admin UI. */
type PermissionKey = keyof typeof PERMISSION_METADATA;
export const PERMISSIONS = Object.freeze(Object.keys(PERMISSION_METADATA) as PermissionKey[]);

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export function isPermission(value: string): value is Permission {
  return permissionSchema.safeParse(value).success;
}
