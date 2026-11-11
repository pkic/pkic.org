import type { Permission } from "../../../../assets/shared/schemas/permissions";
import { SCREEN_REVISION_CONFLICT_CODE } from "../../../../assets/shared/schemas/event-screens";
import { prepareUserBackedAdminFromRequest, requireUserBackedAdminFromRequest } from "../../auth/admin";
import { guardPermissionMutationDatabase, requireAnyPermission } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { D1StatementResult, DatabaseLike, Env, StatementLike, UserBackedAuthAdmin } from "../../types";
import { decodeScreenRecordRow, prepareScreenRecordRead, type ScreenRecordRow } from "./screen-record";

type StaffEnv = Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;

/** A screen belongs to the event it was paired for; once that event is gone only global staff reach it. */
export function screenPermissionContext(row: Pick<ScreenRecordRow, "event_id">) {
  return row.event_id ? { type: "event", id: row.event_id } : undefined;
}

/**
 * Live staff authentication, the screen's record and any caller statements
 * in one batch; the screen's event decides which grants count. Delegated
 * credentials keep their canonical resolver and read the screen afterwards.
 */
export async function readScreenForStaff(
  db: DatabaseLike,
  request: Request,
  env: StaffEnv,
  screenId: string,
  permissions: readonly [Permission, ...Permission[]],
  extra: StatementLike[] = [],
): Promise<{ actor: UserBackedAuthAdmin; row: ScreenRecordRow; extra: D1StatementResult[] }> {
  const statements = [prepareScreenRecordRead(db, screenId), ...extra];
  const auth = await prepareUserBackedAdminFromRequest(db, request, env);
  let actor: UserBackedAuthAdmin;
  let loaded: D1StatementResult[];
  if (!auth) {
    actor = await requireUserBackedAdminFromRequest(db, request, env);
    loaded = await db.batch(statements);
  } else {
    const results = await db.batch([...auth.statements, ...statements]);
    actor = await auth.decode(results.slice(0, auth.statements.length));
    loaded = results.slice(auth.statements.length);
  }
  const row = decodeScreenRecordRow(loaded[0]);
  if (!row) throw new AppError(404, "SCREEN_NOT_FOUND", "Screen not found");
  requireAnyPermission(actor, permissions, screenPermissionContext(row));
  return { actor, row, extra: loaded.slice(1) };
}

/** A screen change rechecks the manager's live permission inside its atomic batch. */
export function screenWriteDatabase(
  db: DatabaseLike,
  actor: UserBackedAuthAdmin,
  permission: Permission,
  context: { type: string; id: string } | undefined,
  alsoContexts: readonly { type: string; id: string }[] = [],
): DatabaseLike {
  return guardPermissionMutationDatabase(
    db,
    actor,
    [context, ...alsoContexts].map((each) => ({ permission, ...(each ? { context: each } : {}) })),
    () => new AppError(409, "SCREEN_AUTHORIZATION_CHANGED", "Your permission to manage this screen changed."),
  );
}

/**
 * Moving a screen out of another event needs the same right there: its ID is
 * not secret and anyone can show a pairing code for it, so the other event's
 * staff would otherwise lose their screen to a manager of any event.
 */
export function requireScreenTransfer(
  actor: UserBackedAuthAdmin,
  permission: Permission,
  row: Pick<ScreenRecordRow, "event_id"> | null,
  targetEventId: string,
): { type: string; id: string }[] {
  if (!row?.event_id || row.event_id === targetEventId) return [];
  const from = { type: "event", id: row.event_id };
  try {
    requireAnyPermission(actor, [permission], from);
  } catch {
    throw new AppError(
      403,
      "SCREEN_BELONGS_TO_ANOTHER_EVENT",
      "This screen belongs to another event. Its organizers can revoke it there, or someone who manages both events can move it.",
    );
  }
  return [from];
}

/** A lost compare-and-set on the screen's revision; the editor reloads and tries again. */
export function screenRevisionConflict(): AppError {
  return new AppError(
    409,
    SCREEN_REVISION_CONFLICT_CODE,
    "The screen changed while you were editing it. Reload and try again.",
  );
}
