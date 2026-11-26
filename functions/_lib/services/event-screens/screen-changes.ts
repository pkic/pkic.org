import { SCREEN_MANAGE_PERMISSION } from "../../../../assets/shared/event-screen-permissions";
import type { ScreenRecord, ScreenUpdate } from "../../../../assets/shared/schemas/event-screens";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import {
  isAuditChangeGuardFailure,
  prepareAuditLogAfterOneChange,
  prepareScopedAuditLogAfterOneChange,
} from "../audit";
import {
  prepareScreenRoomCheck,
  resolveScreenAssignment,
  screenAssignmentColumns,
  screenRoomNotInEvent,
} from "./screen-assignment";
import { decodeScreenRecordRow, prepareScreenRecordRead, toScreenRecord, type ScreenRecordRow } from "./screen-record";
import {
  readScreenForStaff,
  screenPermissionContext,
  screenRevisionConflict,
  screenWriteDatabase,
} from "./screen-staff-access";

type StaffEnv = Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;

/**
 * Renames or reassigns a screen from the revision the editor read. The
 * update is a compare-and-set on that revision and its room's event; the
 * audit row right after it aborts the batch when it changed nothing.
 */
export async function updateScreen(
  db: DatabaseLike,
  request: Request,
  env: StaffEnv,
  screenId: string,
  input: ScreenUpdate,
): Promise<ScreenRecord> {
  const roomCheck = input.assignment
    ? [
        prepareScreenRoomCheck(db, input.assignment.roomId, {
          sql: "(SELECT event_id FROM screens WHERE id=?)",
          bindings: [screenId],
        }),
      ]
    : [];
  const { actor, row, extra } = await readScreenForStaff(
    db,
    request,
    env,
    screenId,
    [SCREEN_MANAGE_PERMISSION],
    roomCheck,
  );
  if (row.revision !== input.expectedRevision) throw screenRevisionConflict();
  if (input.assignment !== undefined && input.assignment !== null) {
    if (!row.event_id)
      throw new AppError(409, "SCREEN_EVENT_REQUIRED", "Pair this screen for an event before assigning it.");
    if (!batchFirst(extra[0])) throw screenRoomNotInEvent();
  }
  const assignment = resolveScreenAssignment(row, input.assignment, actor.id);
  const columns = screenAssignmentColumns(assignment);
  const name = input.name ?? row.name;
  const context = screenPermissionContext(row);
  const write = screenWriteDatabase(db, actor, SCREEN_MANAGE_PERMISSION, context);
  const now = nowIso();
  const details = {
    from: { name: row.name, roomId: row.room_id, output: row.output, layout: row.layout },
    to: { name, roomId: columns[0], output: columns[1], layout: columns[2] },
  };
  try {
    const results = await write.batch([
      write
        .prepare(
          `UPDATE screens SET name=?,room_id=?,output=?,layout=?,assigned_by=?,assigned_at=?,revision=revision+1
            WHERE id=? AND revision=?
              AND (? IS NULL OR EXISTS(SELECT 1 FROM event_agenda_rooms room WHERE room.id=? AND room.event_id=screens.event_id))`,
        )
        .bind(name, ...columns, screenId, input.expectedRevision, columns[0], columns[0]),
      context
        ? prepareScopedAuditLogAfterOneChange(
            write,
            context,
            "user",
            actor.id,
            "screen.updated",
            "screen",
            screenId,
            details,
            now,
          )
        : prepareAuditLogAfterOneChange(write, "user", actor.id, "screen.updated", "screen", screenId, details, now),
      prepareScreenRecordRead(write, screenId),
    ]);
    return toScreenRecord(decodeScreenRecordRow(results.at(-1)!) as ScreenRecordRow);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) throw screenRevisionConflict();
    throw error;
  }
}

/**
 * Removes a screen, signed in or not. Its sign-ins and pairing approvals
 * cascade, so its device shows a pairing code on its next request. The
 * delete matches the screen's event and revision as read, so a screen that
 * moved or changed since then deletes nothing and the audit row's guard rolls
 * the batch back.
 */
export async function removeScreen(db: DatabaseLike, request: Request, env: StaffEnv, screenId: string): Promise<void> {
  const { actor, row } = await readScreenForStaff(db, request, env, screenId, [SCREEN_MANAGE_PERMISSION]);
  const now = nowIso();
  const context = screenPermissionContext(row);
  const write = screenWriteDatabase(db, actor, SCREEN_MANAGE_PERMISSION, context);
  const details = { name: row.name };
  try {
    await write.batch([
      // The screen as authorized: a move to another event or any other change since the read deletes nothing.
      write
        .prepare("DELETE FROM screens WHERE id=? AND event_id IS ? AND revision=?")
        .bind(screenId, row.event_id, row.revision),
      context
        ? prepareScopedAuditLogAfterOneChange(
            write,
            context,
            "user",
            actor.id,
            "screen.removed",
            "screen",
            screenId,
            details,
            now,
          )
        : prepareAuditLogAfterOneChange(write, "user", actor.id, "screen.removed", "screen", screenId, details, now),
    ]);
  } catch (error) {
    // It moved or changed since the read: the list reloads and shows it as it stands.
    if (isAuditChangeGuardFailure(error)) throw screenRevisionConflict();
    throw error;
  }
}
