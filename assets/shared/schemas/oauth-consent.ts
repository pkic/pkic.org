import { z } from "zod";
import { permissionSchema, PERMISSIONS } from "./permissions";

export const oauthApprovedScopesSchema = z
  .array(permissionSchema)
  .min(1, "Select at least one permission or deny access.")
  .max(PERMISSIONS.length)
  .refine((scopes) => new Set(scopes).size === scopes.length, "Select each permission only once.");
