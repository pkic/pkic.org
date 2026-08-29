import { z } from "zod";

/** Canonical permission vocabulary shared by the Worker and admin UI. */
export const PERMISSIONS = [
  "membership:read",
  "membership:write",
  "membership:approve",
  "events:read",
  "events:write",
  "events:manage",
  "groups:read",
  "groups:write",
  "email-templates:read",
  "email-templates:write",
  "forms:read",
  "forms:write",
  "email:read",
  "email:manage",
  "donations:read",
  "donations:sync",
  "users:read",
  "users:write",
  "users:anonymize",
  "audit:read",
  "analytics:read",
  "operations:read",
  "operations:run",
  "access:grant",
  "access:revoke",
  "organizations:read",
  "organizations:write",
  "organizations:content-review",
  "sponsorships:read",
  "sponsorships:write",
  "votes:create",
  "votes:manage",
  "proposals:read",
  "proposals:score",
  "proposals:manage",
  "proposals:edit_accepted_abstract",
  "proposals:cancel_accepted",
  "agenda:read",
  "agenda:write",
  "sponsor-portal:attendee-data",
  "admin:read",
  "admin:write",
] as const;

export const permissionSchema = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof permissionSchema>;

export function isPermission(value: string): value is Permission {
  return permissionSchema.safeParse(value).success;
}
