import { z } from "zod";

export const publicStaffGrantSchema = z.object({
  // Stored contextual permissions may include additively introduced values
  // that predate the current UI vocabulary; preserve them in session status.
  permission: z.string().min(1),
  contextType: z.string().nullable(),
  contextId: z.string().nullable(),
});

/** Allowlisted staff capacity returned as part of the canonical user session. */
export const publicStaffCapacitySchema = z.object({
  id: z.string().min(1),
  email: z.string().min(1),
  role: z.string().min(1),
  scopes: z.array(z.string().min(1)),
  grants: z.array(publicStaffGrantSchema),
  expiresAt: z.string().nullable(),
});
export type PublicStaffCapacity = z.infer<typeof publicStaffCapacitySchema>;
