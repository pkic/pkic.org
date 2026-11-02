import { prepareUserBackedAdminFromRequest, requireUserBackedAdminFromRequest } from "./admin";
import { requirePermission } from "./permissions";
import type { Permission } from "../../../assets/shared/schemas/permissions";
import type { DatabaseLike, D1StatementResult, Env, StatementLike } from "../types";

/** Resolve live user-backed staff authority and its read-only projection in one serving snapshot. */
export async function readStaffProjection<T>(
  db: DatabaseLike,
  request: Request,
  env: Env,
  permission: Permission,
  read: { statements: StatementLike[]; decode(loaded: D1StatementResult[]): T },
) {
  const actor = await prepareUserBackedAdminFromRequest(db, request, env);
  if (!actor) {
    const current = await requireUserBackedAdminFromRequest(db, request, env);
    requirePermission(current, permission);
    return read.decode(await db.batch(read.statements));
  }
  const loaded = await db.batch([...actor.statements, ...read.statements]);
  requirePermission(await actor.decode(loaded.slice(0, actor.statements.length)), permission);
  return read.decode(loaded.slice(actor.statements.length));
}
