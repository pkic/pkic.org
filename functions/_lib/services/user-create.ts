import type { UserCreateInput } from "../../../assets/shared/schemas/user-create";
import { requirePermission } from "../auth/permissions";
import { AppError } from "../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../types";
import { prepareAuditLog } from "./audit";
import { authorizedUserMutationDb } from "./user-management-authorization";
import { buildFindOrCreateUserStatement, findUserByEmail } from "./users";

function emailAlreadyUsed() {
  return new AppError(409, "USER_EMAIL_IN_USE", "This email is already associated with a user", {
    fieldErrors: { email: ["Open the existing user record instead."] },
    formErrors: [],
  });
}

/** Create a bare person record without granting membership, staff access, or mailbox verification. */
export async function createUser(db: DatabaseLike, actor: UserBackedAuthAdmin, input: UserCreateInput) {
  requirePermission(actor, "users:write");
  const guarded = authorizedUserMutationDb(db, actor, ["users:write"]);
  const prepared = await buildFindOrCreateUserStatement(guarded, {
    email: input.email,
    firstName: input.firstName ?? undefined,
    lastName: input.lastName ?? undefined,
  });
  if (!prepared.created || !prepared.statement) throw emailAlreadyUsed();
  try {
    await guarded.batch([
      prepared.statement,
      prepareAuditLog(guarded, "admin", actor.id, "user_created", "user", prepared.user.id, { email: input.email }),
    ]);
  } catch (error) {
    if (await findUserByEmail(db, input.email)) throw emailAlreadyUsed();
    throw error;
  }
  return { success: true as const, userId: prepared.user.id };
}
