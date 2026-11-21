import {
  DEFAULT_LIVE_ROOM_OUTPUTS,
  LIVE_RESERVED_OUTPUT_KEYS,
  LIVE_SPEAKER_OUTPUT_KEY,
  liveRoomOutputsSchema,
  type LiveRoomOutput,
  type LiveRoomOutputsRequest,
  type LiveRoomOutputsResponse,
} from "../../../../assets/shared/schemas/live-room-output-setup";
import { preparePermissionsAuthorizationGuard } from "../../auth/permissions";
import { isAuthorizationGuardFailure } from "../../db/authorization-guard";
import { first } from "../../db/queries";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";
import { parseJsonSafe } from "../../utils/json";
import { nowIso } from "../../utils/time";
import { prepareScopedAuditLog } from "../audit";
import type { EventRecord } from "../events";

/**
 * The outputs a physical room sets up beside Program. The room's live
 * sessions read them with their session (see room-session), so a studio or a
 * browser source picks up a change when it next connects.
 */

/** One room's outputs as a JSON array in their order, for the room the SQL expression `roomId` names. */
export function liveRoomOutputsJsonSql(roomId: string): string {
  return `SELECT json_group_array(json_object('key',output.output_key,'name',output.name,'code',output.code,'role',output.role,'scene',output.scene_slug,'sceneLocked',json(CASE WHEN output.scene_locked THEN 'true' ELSE 'false' END)))
    FROM (SELECT output_key,name,code,role,scene_slug,scene_locked FROM event_agenda_room_outputs WHERE room_id=${roomId} ORDER BY position) output`;
}

/** The saved outputs, or undefined while the room has none saved and keeps the ones it always had. */
export function decodeLiveRoomOutputs(json: string | null): LiveRoomOutput[] | undefined {
  const parsed = liveRoomOutputsSchema.safeParse(parseJsonSafe<unknown>(json, []));
  return parsed.success && parsed.data.length ? parsed.data : undefined;
}

const roomNotFound = () => new AppError(404, "AGENDA_ROOM_NOT_FOUND", "Location not found");

async function readSaved(db: DatabaseLike, eventId: string, roomId: string) {
  const row = await first<{ id: string; outputs_json: string | null }>(
    db,
    `SELECT room.id,(${liveRoomOutputsJsonSql("room.id")}) AS outputs_json
     FROM event_agenda_rooms room WHERE room.event_id=? AND room.id=?`,
    [eventId, roomId],
  );
  if (!row) throw roomNotFound();
  return decodeLiveRoomOutputs(row.outputs_json);
}

/** The room's outputs, in order; the ones it always had until anyone sets them up. */
export async function readLiveRoomOutputs(
  db: DatabaseLike,
  eventId: string,
  roomId: string,
): Promise<LiveRoomOutputsResponse> {
  return { outputs: (await readSaved(db, eventId, roomId)) ?? [...DEFAULT_LIVE_ROOM_OUTPUTS] };
}

/** A new output's key, made once from its code: `PRJ L` becomes `prj-l`, kept clear of every key in use. */
export function liveRoomOutputKey(code: string, taken: ReadonlySet<string>): string {
  const base =
    code
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "output";
  const start = /^[a-z]/.test(base) ? base : `output-${base}`;
  const blocked = (key: string) =>
    taken.has(key) || key === LIVE_SPEAKER_OUTPUT_KEY || (LIVE_RESERVED_OUTPUT_KEYS as readonly string[]).includes(key);
  if (!blocked(start)) return start;
  for (let suffix = 2; ; suffix += 1) if (!blocked(`${start}-${suffix}`)) return `${start}-${suffix}`;
}

/**
 * Replaces the room's outputs with the list as sent, in its order. An output
 * keeps its key for good, so its links and the room's state keep working;
 * the speaker's screen always keeps the key every speaker screen link uses.
 */
export async function saveLiveRoomOutputs(
  db: DatabaseLike,
  input: { event: EventRecord; actor: UserBackedAuthAdmin; roomId: string; request: LiveRoomOutputsRequest },
): Promise<LiveRoomOutputsResponse> {
  const { event, actor, roomId, request } = input;
  const current = (await readSaved(db, event.id, roomId)) ?? DEFAULT_LIVE_ROOM_OUTPUTS;
  const known = new Set(current.map((output) => output.key));
  const taken = new Set(request.outputs.flatMap((output) => (output.key && known.has(output.key) ? [output.key] : [])));
  const outputs: LiveRoomOutput[] = request.outputs.map((output) => {
    const kept = output.key && known.has(output.key) && output.role !== "speaker" ? output.key : null;
    const key =
      output.role === "speaker"
        ? LIVE_SPEAKER_OUTPUT_KEY
        : kept && kept !== LIVE_SPEAKER_OUTPUT_KEY
          ? kept
          : liveRoomOutputKey(output.code, taken);
    taken.add(key);
    return {
      key,
      name: output.name,
      code: output.code,
      role: output.role,
      scene: output.scene,
      sceneLocked: output.sceneLocked,
    };
  });
  const checked = liveRoomOutputsSchema.safeParse(outputs);
  if (!checked.success)
    throw new AppError(422, "LIVE_ROOM_OUTPUTS_INVALID", checked.error.issues[0]?.message ?? "Check the screens.");
  const at = nowIso();
  const context = { type: "event", id: event.id };
  try {
    await db.batch([
      preparePermissionsAuthorizationGuard(db, actor, [{ permission: "agenda:live_studio", context }]),
      db.prepare("DELETE FROM event_agenda_room_outputs WHERE event_id=? AND room_id=?").bind(event.id, roomId),
      ...checked.data.map((output, position) =>
        db
          .prepare(
            `INSERT INTO event_agenda_room_outputs(event_id,room_id,output_key,name,code,role,scene_slug,scene_locked,position,updated_at,updated_by_user_id)
             VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            event.id,
            roomId,
            output.key,
            output.name,
            output.code,
            output.role,
            output.scene,
            output.sceneLocked ? 1 : 0,
            position,
            at,
            actor.id,
          ),
      ),
      prepareScopedAuditLog(
        db,
        context,
        "admin",
        actor.id,
        "live_room.outputs.save",
        "agenda_room",
        roomId,
        {
          outputs: checked.data.map(({ key, code, role, scene, sceneLocked }) => ({
            key,
            code,
            role,
            scene,
            sceneLocked,
          })),
        },
        at,
      ),
    ]);
  } catch (error) {
    if (isAuthorizationGuardFailure(error))
      throw new AppError(403, "LIVE_SETTINGS_ACCESS_CHANGED", "Your access to live settings changed.");
    throw error;
  }
  return { outputs: checked.data };
}
