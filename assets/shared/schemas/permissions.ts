import { z } from "zod";

import { PERMISSION_METADATA } from "../permission-metadata";

/** Canonical permission vocabulary derives from the metadata catalog, never a second list. */
export const PERMISSIONS = Object.freeze(Object.keys(PERMISSION_METADATA) as (keyof typeof PERMISSION_METADATA)[]);

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export function isPermission(value: string): value is Permission {
  return permissionSchema.safeParse(value).success;
}
