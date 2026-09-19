import type { ValidatedData } from "chanfana";
import type { z } from "zod";
import { requireIdentityFromRequest } from "../auth/user-session";
import { requestDb, type AdminContext } from "../db/context";
import type { ParticipantAuthority } from "../services/participant-authority";

/** Shared handlers accept either a verified session identity or the public link parameter. */
export type ParticipantRouteData<Schema extends { request: { params: z.ZodObject } }> = Omit<
  ValidatedData<Schema>,
  "params"
> & {
  params: Omit<z.output<Schema["request"]["params"]>, "token"> & { token: ParticipantAuthority };
};

export async function requireParticipantAuthority(c: AdminContext, resourceId: string) {
  const identity = await requireIdentityFromRequest(requestDb(c), c.req.raw, c.env);
  return { resourceId, userId: identity.userId };
}
