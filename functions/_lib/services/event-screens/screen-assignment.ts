import type { ScreenAssignmentInput } from "../../../../assets/shared/schemas/event-screens";
import type { DatabaseLike, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import type { ScreenRecordRow } from "./screen-record";

/** What a screen shows after a change, and who set it; null when unassigned. */
export type ResolvedScreenAssignment = {
  roomId: string;
  output: string;
  layout: string | null;
  assignedBy: string | null;
  assignedAt: string;
} | null;

/**
 * An omitted assignment keeps the current one, `null` clears it, and a new
 * one is attributed to the person setting it. `current` is the screen as it
 * stands in the same event; a screen arriving from another event has none.
 */
export function resolveScreenAssignment(
  current: Pick<ScreenRecordRow, "room_id" | "output" | "layout" | "assigned_by" | "assigned_at"> | null,
  input: ScreenAssignmentInput | null | undefined,
  actorId: string,
): ResolvedScreenAssignment {
  if (input === undefined)
    return current?.room_id && current.output && current.assigned_at
      ? {
          roomId: current.room_id,
          output: current.output,
          layout: current.layout,
          assignedBy: current.assigned_by,
          assignedAt: current.assigned_at,
        }
      : null;
  if (input === null) return null;
  return {
    roomId: input.roomId,
    output: input.output,
    layout: input.layout,
    assignedBy: actorId,
    assignedAt: nowIso(),
  };
}

/** room_id, output, layout, assigned_by, assigned_at, in that order. */
export function screenAssignmentColumns(assignment: ResolvedScreenAssignment) {
  return assignment
    ? ([assignment.roomId, assignment.output, assignment.layout, assignment.assignedBy, assignment.assignedAt] as const)
    : ([null, null, null, null, null] as const);
}

/** Whether a room belongs to the event the trusted selection names. */
export function prepareScreenRoomCheck(
  db: DatabaseLike,
  roomId: string,
  event: { sql: string; bindings: readonly unknown[] },
): StatementLike {
  return db
    .prepare(`SELECT id FROM event_agenda_rooms WHERE id=? AND event_id=${event.sql}`)
    .bind(roomId, ...event.bindings);
}
