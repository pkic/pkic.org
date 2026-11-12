import { SCREEN_MANAGE_PERMISSION } from "../../../../assets/shared/event-screen-permissions";
import {
  SCREEN_ID_TAKEN_CODE,
  type ScreenDeviceReplacement,
  type ScreenRecord,
} from "../../../../assets/shared/schemas/event-screens";
import { AppError } from "../../errors";
import type { DatabaseLike, Env } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { decodeScreenRecordRow, prepareScreenRecordRead, toScreenRecord, type ScreenRecordRow } from "./screen-record";
import { prepareScreenPairingApproval } from "./screen-pairing";
import {
  readScreenForStaff,
  screenPermissionContext,
  screenRevisionConflict,
  screenWriteDatabase,
} from "./screen-staff-access";

type StaffEnv = Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;

/**
 * Moves a screen to a new device. One atomic batch adds the new device's
 * screen ID with the screen's name, event and assignment, holds its pending
 * sign-in as pairing does, removes the old screen ID (its sign-ins cascade,
 * so the old device shows a pairing code) and records both. The copy is a
 * compare-and-set on the revision the dialog read; the audit row after it
 * aborts the batch when it changed nothing.
 */
export async function replaceScreenDevice(
  db: DatabaseLike,
  request: Request,
  env: StaffEnv,
  screenId: string,
  input: ScreenDeviceReplacement,
): Promise<ScreenRecord> {
  if (input.newScreenId === screenId) {
    const message = "This is the screen's current ID. Enter the ID shown on the new device.";
    throw new AppError(422, "SCREEN_ID_UNCHANGED", message, {
      formErrors: [],
      fieldErrors: { newScreenId: [message] },
    });
  }
  const { actor, row, extra } = await readScreenForStaff(
    db,
    request,
    env,
    screenId,
    [SCREEN_MANAGE_PERMISSION],
    [prepareScreenRecordRead(db, input.newScreenId)],
  );
  if (row.revision !== input.expectedRevision) throw screenRevisionConflict();
  const context = screenPermissionContext(row);
  if (!context) throw new AppError(409, "SCREEN_EVENT_REQUIRED", "Pair this screen for an event before replacing it.");
  const taken = decodeScreenRecordRow(extra[0]);
  if (taken) throw screenIdTaken(taken.event_id === row.event_id ? taken.name : null);
  const write = screenWriteDatabase(db, actor, SCREEN_MANAGE_PERMISSION, context);
  const now = nowIso();
  try {
    const results = await write.batch([
      write
        .prepare(
          `INSERT INTO screens(id,name,event_id,room_id,output,layout,revision,assigned_by,assigned_at,created_by,created_at)
           SELECT ?,name,event_id,room_id,output,layout,revision+1,assigned_by,assigned_at,created_by,created_at
             FROM screens WHERE id=? AND revision=? AND event_id=? AND NOT EXISTS(SELECT 1 FROM screens taken WHERE taken.id=?)`,
        )
        .bind(input.newScreenId, screenId, input.expectedRevision, context.id, input.newScreenId),
      prepareScopedAuditLogAfterOneChange(
        write,
        context,
        "user",
        actor.id,
        "screen.paired",
        "screen",
        input.newScreenId,
        {
          name: row.name,
          replaces: screenId,
          assignment: row.room_id && row.output ? { roomId: row.room_id, output: row.output } : null,
        },
        now,
      ),
      await prepareScreenPairingApproval(write, input.newScreenId, input.pairingCode, actor.id, now),
      write.prepare("DELETE FROM screens WHERE id=?").bind(screenId),
      prepareScopedAuditLogAfterOneChange(
        write,
        context,
        "user",
        actor.id,
        "screen.replaced",
        "screen",
        screenId,
        { name: row.name, replacedBy: input.newScreenId },
        now,
      ),
      prepareScreenRecordRead(write, input.newScreenId),
    ]);
    return toScreenRecord(decodeScreenRecordRow(results.at(-1)!) as ScreenRecordRow);
  } catch (error) {
    if (isAuditChangeGuardFailure(error)) throw screenRevisionConflict();
    throw error;
  }
}

/**
 * The new device's screen ID already names a screen. A screen of this event
 * is named so staff can find it; another event's stays anonymous.
 */
function screenIdTaken(name: string | null): AppError {
  const message = name
    ? `“${name}” has this screen ID. Remove it first, or check the ID.`
    : "Another event's screen has this screen ID. Check the ID.";
  return new AppError(409, SCREEN_ID_TAKEN_CODE, "The new screen ID belongs to another screen.", {
    formErrors: [],
    fieldErrors: { newScreenId: [message] },
  });
}
