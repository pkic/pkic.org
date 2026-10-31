/** One corrective transition, shared by the owner and authorized staff without creating former-role history. */
import type { z } from "zod";
import { identityCorrectionSchema } from "../../../../assets/shared/schemas/identity";
import type { DatabaseLike, Env } from "../../types";
import { prepareAuthorizationGuard } from "../../db/authorization-guard";
import { prepareRepresentationAuthority } from "./representation-authority";
import { nowIso } from "../../utils/time";
import { prepareIncorrectRepresentationRemoval, incorrectRepresentationRemovalError } from "./representation-removal";

export async function correctRepresentation(
  db: DatabaseLike,
  request: Request,
  env: Env,
  userId: string,
  identityId: string,
  input: z.infer<typeof identityCorrectionSchema>,
) {
  const actor = await prepareRepresentationAuthority(db, request, env, userId, [
    { permission: "membership:write" },
    { permission: "identities:activate" },
  ]);
  try {
    const loaded = await db.batch([
      ...actor.statements,
      ...actor.evidence.map((evidence) => prepareAuthorizationGuard(db, evidence)),
      ...prepareIncorrectRepresentationRemoval(db, {
        identityId,
        actorId: actor.actorId,
        ownerId: userId,
        at: nowIso(),
        correction: input,
      }),
    ]);
    await actor.decode(loaded.slice(0, actor.statements.length));
  } catch (cause) {
    incorrectRepresentationRemovalError(cause, true);
  }
  return { success: true as const, identityId: input.replacementIdentityId, state: "active" as const };
}
