import { SCREEN_MANAGE_PERMISSION } from "../../../../assets/shared/event-screen-permissions";
import {
  SCREEN_ID_IN_USE_CODE,
  SCREEN_ID_TAKEN_CODE,
  type ScreenDeviceReplacement,
  type ScreenRecord,
} from "../../../../assets/shared/schemas/event-screens";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { decodeScreenRecordRow, prepareScreenRecordRead, toScreenRecord, type ScreenRecordRow } from "./screen-record";
import { prepareScreenPairingApproval, screenSignedIn } from "./screen-pairing";
import {
  readScreenForStaff,
  requireScreenTransfer,
  screenPermissionContext,
  screenRevisionConflict,
  screenWriteDatabase,
} from "./screen-staff-access";

type StaffEnv = Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">;

/**
 * Moves a screen to a new device. One atomic batch puts the screen's name,
 * event and assignment on the new device's screen ID, holds its pending
 * sign-in as pairing does, removes the old screen ID (its sign-ins cascade,
 * so the old device shows a pairing code) and records both.
 *
 * A screen that already has the new screen ID, as a reinstalled device staff
 * paired as a screen of its own, gives way only with `replace`: its record
 * takes this screen's name and assignment, and a device signed in under that
 * ID keeps its sign-in, so it needs no pairing code. Moving it out of another
 * event needs the right there too.
 *
 * Each write is a compare-and-set on the revisions read; the audit row after
 * it aborts the batch when it changed nothing.
 */
export async function replaceScreenDevice(
  db: DatabaseLike,
  request: Request,
  env: StaffEnv,
  screenId: string,
  input: ScreenDeviceReplacement,
): Promise<ScreenRecord> {
  if (input.newScreenId === screenId) {
    throw fieldRefusal(
      422,
      "SCREEN_ID_UNCHANGED",
      "newScreenId",
      "This is the screen's current ID. Enter the ID shown on the new device.",
    );
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
  const now = nowIso();
  const taken = decodeScreenRecordRow(extra[0]);
  const takenSignedIn = taken !== null && screenSignedIn(taken, now);
  if (taken && !input.replace) throw screenIdTaken(taken.event_id === row.event_id ? taken.name : null, takenSignedIn);
  if (!input.pairingCode && !takenSignedIn) {
    throw fieldRefusal(
      422,
      "SCREEN_PAIRING_CODE_REQUIRED",
      "pairingCode",
      "Enter the pairing code shown on the new device.",
    );
  }
  const takenFrom = taken ? requireScreenTransfer(actor, SCREEN_MANAGE_PERMISSION, taken, context.id) : [];
  const write = screenWriteDatabase(db, actor, SCREEN_MANAGE_PERMISSION, context, takenFrom);
  const approval: StatementLike[] = input.pairingCode
    ? [
        write
          .prepare(
            "UPDATE screen_sessions SET revoked_at=? WHERE screen_id=? AND activated_at IS NULL AND revoked_at IS NULL",
          )
          .bind(now, input.newScreenId),
        await prepareScreenPairingApproval(write, input.newScreenId, input.pairingCode, actor.id, now),
      ]
    : [];
  try {
    const results = await write.batch([
      taken
        ? write
            .prepare(
              `UPDATE screens SET name=?,event_id=?,room_id=?,output=?,layout=?,assigned_by=?,assigned_at=?,revision=revision+1
                WHERE id=? AND revision=? AND event_id IS ?`,
            )
            .bind(
              row.name,
              row.event_id,
              row.room_id,
              row.output,
              row.layout,
              row.assigned_by,
              row.assigned_at,
              input.newScreenId,
              taken.revision,
              taken.event_id,
            )
        : write
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
          ...(taken ? { tookOver: { name: taken.name, eventId: taken.event_id } } : {}),
        },
        now,
      ),
      ...approval,
      write.prepare("DELETE FROM screens WHERE id=? AND revision=?").bind(screenId, input.expectedRevision),
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
 * is named so staff can find it; another event's stays anonymous. A signed-in
 * one is most likely the new device itself, paired as a screen of its own.
 */
function screenIdTaken(name: string | null, signedIn: boolean): AppError {
  const holder = name ? `“${name}”` : "A screen of another event";
  return fieldRefusal(
    409,
    signedIn ? SCREEN_ID_IN_USE_CODE : SCREEN_ID_TAKEN_CODE,
    "newScreenId",
    signedIn
      ? `${holder} has this screen ID and is signed in. Check the ID, or replace it.`
      : `${holder} has this screen ID. Check the ID, or replace it.`,
  );
}

function fieldRefusal(status: number, code: string, field: "newScreenId" | "pairingCode", message: string): AppError {
  return new AppError(status, code, message, { formErrors: [], fieldErrors: { [field]: [message] } });
}
