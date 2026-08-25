import { AppError } from "../../errors";
import { buildOffsetPageStatements, decodeOffsetPageResults, type OffsetPageQuery } from "../../db/pagination";
import type { AuthAdmin, D1StatementResult, DatabaseLike, StatementLike } from "../../types";
import { uuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import { getGroup } from "../groups";
import { requireGroupResourceAccess } from "../resource-grants";

export type EventResourceManagementCapability = "manage" | "manage_attendance";

export interface EventResourceManagementContext {
  eventId: string;
  groupId: string;
}

export async function requireEventResourceManagementContext(
  db: DatabaseLike,
  actor: AuthAdmin,
  groupIdOrSlug: string,
  eventId: string,
  capability: EventResourceManagementCapability,
): Promise<EventResourceManagementContext> {
  const group = await getGroup(db, groupIdOrSlug);
  if (!group) throw new AppError(404, "GROUP_NOT_FOUND", "Group not found");
  await requireGroupResourceAccess(db, actor, "event", eventId, capability, group.id);
  return { eventId, groupId: group.id };
}

function prepareEventResourceManagementGuard(
  db: DatabaseLike,
  actor: AuthAdmin,
  context: EventResourceManagementContext,
  capability: EventResourceManagementCapability,
): StatementLike {
  return db
    .prepare(
      `INSERT INTO event_resource_management_guards
         (id, event_id, group_id, required_capability, actor_user_id, trusted_service, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      uuid(),
      context.eventId,
      context.groupId,
      capability,
      actor.identityType === "user" ? actor.id : null,
      actor.identityType === "service" ? 1 : 0,
      nowIso(),
    );
}

/**
 * Revalidates the exact event grant and effective group leadership inside the
 * same D1 transaction as every protected write.
 */
export async function commitEventResourceManagementBatch(
  db: DatabaseLike,
  actor: AuthAdmin,
  context: EventResourceManagementContext,
  capability: EventResourceManagementCapability,
  statements: StatementLike[],
): Promise<D1StatementResult[]> {
  return executeEventResourceManagementBatch(db, actor, context, capability, statements);
}

async function executeEventResourceManagementBatch(
  db: DatabaseLike,
  actor: AuthAdmin,
  context: EventResourceManagementContext,
  capability: EventResourceManagementCapability,
  statements: StatementLike[],
): Promise<D1StatementResult[]> {
  try {
    return await db.batch([prepareEventResourceManagementGuard(db, actor, context, capability), ...statements]);
  } catch (error) {
    if (error instanceof Error && error.message.includes("EVENT_RESOURCE_MANAGEMENT_CONTEXT_CHANGED")) {
      if (capability === "manage_attendance") {
        throw new AppError(
          409,
          "EVENT_ATTENDANCE_MANAGEMENT_CONTEXT_CHANGED",
          "Attendance-management access changed while the update was being saved",
        );
      }
      throw new AppError(
        409,
        "EVENT_MANAGEMENT_CONTEXT_CHANGED",
        "Event-management access changed while the update was being saved",
      );
    }
    throw error;
  }
}

/** Revalidates event-management authority in the same D1 batch as a page and its count. */
export async function queryEventResourceManagementPage<T>(
  db: DatabaseLike,
  actor: AuthAdmin,
  context: EventResourceManagementContext,
  capability: EventResourceManagementCapability,
  query: OffsetPageQuery,
): Promise<{ rows: T[]; total: number }> {
  const [, pageResult, countResult] = await executeEventResourceManagementBatch(
    db,
    actor,
    context,
    capability,
    buildOffsetPageStatements(db, query),
  );
  return decodeOffsetPageResults<T>(pageResult, countResult);
}
