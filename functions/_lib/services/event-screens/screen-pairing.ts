import { SCREEN_MANAGE_PERMISSION } from "../../../../assets/shared/event-screen-permissions";
import { SCREEN_POLICY } from "../../../../assets/shared/event-screen-policy";
import {
  SCREEN_ID_IN_USE_CODE,
  type EventScreenPairingCreate,
  type ScreenRecord,
  type ScreenSessionPollResponse,
} from "../../../../assets/shared/schemas/event-screens";
import { screenPairingCodeHash } from "../../auth/screen-pairing-challenge";
import { batchFirst } from "../../db/pagination";
import { AppError } from "../../errors";
import type { DatabaseLike, Env, StatementLike } from "../../types";
import { randomToken, sha256Hex } from "../../utils/crypto";
import { addHours, addMinutes, nowIso } from "../../utils/time";
import { isAuditChangeGuardFailure, prepareScopedAuditLogAfterOneChange } from "../audit";
import { readEventAdminResource } from "../events/authorized-context";
import { eventReadIdSql } from "../events/selection";
import { decodeScreenRecordRow, prepareScreenRecordRead, toScreenRecord, type ScreenRecordRow } from "./screen-record";
import {
  prepareScreenRoomCheck,
  resolveScreenAssignment,
  screenAssignmentColumns,
  screenRoomNotInEvent,
} from "./screen-assignment";
import { requireScreenTransfer, screenRevisionConflict, screenWriteDatabase } from "./screen-staff-access";

/**
 * Staff approve the code a screen shows. One atomic batch adds the screen to
 * the event (or moves it here), supersedes any earlier pending approval, holds
 * a pending sign-in with the code's hash, and records the pairing. Nothing
 * signs the screen in until its browser presents the matching challenge.
 * Without `replace`, the write itself refuses a screen that is signed in, so
 * a sign-in that lands after the read rolls the whole batch back.
 */
export async function approveScreenPairing(
  db: DatabaseLike,
  request: Request,
  env: Pick<Env, "ADMIN_API_KEY" | "INTERNAL_SIGNING_SECRET">,
  eventSlug: string,
  input: EventScreenPairingCreate,
): Promise<ScreenRecord> {
  return readEventAdminResource(db, request, env, eventSlug, SCREEN_MANAGE_PERMISSION, (event) => {
    const statements = [prepareScreenRecordRead(db, input.screenId)];
    const eventId = eventReadIdSql(event);
    if (input.assignment) statements.push(prepareScreenRoomCheck(db, input.assignment.roomId, eventId));
    return {
      statements,
      async decode(loaded, event, actor) {
        const existing = decodeScreenRecordRow(loaded[0]);
        if (input.assignment && !batchFirst(loaded[1])) throw screenRoomNotInEvent();
        const assignment = resolveScreenAssignment(
          existing && existing.event_id === event.id ? existing : null,
          input.assignment,
          actor.id,
        );
        const transferFrom = requireScreenTransfer(actor, SCREEN_MANAGE_PERMISSION, existing, event.id);
        const now = nowIso();
        if (!input.replace && existing && screenSignedIn(existing, now)) throw screenIdInUse(existing.name);
        const write = screenWriteDatabase(
          db,
          actor,
          SCREEN_MANAGE_PERMISSION,
          { type: "event", id: event.id },
          transferFrom,
        );
        const columns = screenAssignmentColumns(assignment);
        try {
          const results = await write.batch([
            write
              .prepare(
                `INSERT INTO screens(id,name,event_id,room_id,output,layout,revision,assigned_by,assigned_at,created_by,created_at)
                 SELECT ?,?,?,?,?,?,0,?,?,?,? WHERE ? IS NULL OR EXISTS(SELECT 1 FROM event_agenda_rooms WHERE id=? AND event_id=?)
                 ON CONFLICT(id) DO UPDATE SET name=excluded.name,event_id=excluded.event_id,room_id=excluded.room_id,
                   output=excluded.output,layout=excluded.layout,assigned_by=excluded.assigned_by,
                   assigned_at=excluded.assigned_at,revision=screens.revision+1
                 WHERE screens.revision IS ? AND (? OR NOT ${SCREEN_LIVE_SIGN_IN})`,
              )
              .bind(
                input.screenId,
                input.name,
                event.id,
                ...columns,
                actor.id,
                now,
                columns[0],
                columns[0],
                event.id,
                existing?.revision ?? null,
                input.replace ? 1 : 0,
                input.screenId,
                now,
              ),
            prepareScopedAuditLogAfterOneChange(
              write,
              { type: "event", id: event.id },
              "user",
              actor.id,
              "screen.paired",
              "screen",
              input.screenId,
              {
                name: input.name,
                previousEventId: existing && existing.event_id !== event.id ? existing.event_id : undefined,
                assignment: assignment ? { roomId: assignment.roomId, output: assignment.output } : null,
              },
              now,
            ),
            write
              .prepare(
                "UPDATE screen_sessions SET revoked_at=? WHERE screen_id=? AND activated_at IS NULL AND revoked_at IS NULL",
              )
              .bind(now, input.screenId),
            await prepareScreenPairingApproval(write, input.screenId, input.pairingCode, actor.id, now),
            prepareScreenRecordRead(write, input.screenId),
          ]);
          return toScreenRecord(decodeScreenRecordRow(results.at(-1)!) as ScreenRecordRow);
        } catch (error) {
          if (!isAuditChangeGuardFailure(error)) throw error;
          // A sign-in that landed since the read is told apart from any other change.
          const current = input.replace
            ? null
            : await prepareScreenRecordRead(db, input.screenId).first<ScreenRecordRow>();
          throw current && screenSignedIn(current, nowIso()) ? screenIdInUse(current.name) : screenRevisionConflict();
        }
      },
    };
  });
}

/**
 * The pending sign-in a staff approval holds: the code's hash, valid for the
 * code's lifetime, until the screen collects it with its challenge.
 */
export async function prepareScreenPairingApproval(
  db: DatabaseLike,
  screenId: string,
  pairingCode: string,
  actorId: string,
  now: string,
): Promise<StatementLike> {
  return db
    .prepare(
      `INSERT INTO screen_sessions(id,screen_id,token_hash,pairing_code_hash,approved_by,created_at,expires_at)
       VALUES(?,?,?,?,?,?,?)`,
    )
    .bind(
      crypto.randomUUID(),
      screenId,
      await sha256Hex(randomToken(32)),
      await screenPairingCodeHash(screenId, pairingCode),
      actorId,
      now,
      addMinutes(now, SCREEN_POLICY.pairingMinutes),
    );
}

/**
 * The same as SQL, for a statement that binds the screen ID and now: a live
 * sign-in guards a write that must not land over a screen that is signed in.
 */
export const SCREEN_LIVE_SIGN_IN = `EXISTS(SELECT 1 FROM screen_sessions live WHERE live.screen_id=?
  AND live.activated_at IS NOT NULL AND live.revoked_at IS NULL AND live.expires_at>?)`;

/** A screen signed in now: an activated sign-in that has not run out. */
export function screenSignedIn(
  row: Pick<ScreenRecordRow, "session_activated_at" | "session_expires_at">,
  now: string,
): boolean {
  return row.session_activated_at !== null && row.session_expires_at !== null && row.session_expires_at > now;
}

/**
 * Pairing over a screen that is signed in would sign it out: likely a
 * mistyped ID, or two screens sharing one. Staff confirm it to go ahead.
 */
function screenIdInUse(name: string): AppError {
  return new AppError(409, SCREEN_ID_IN_USE_CODE, "This screen ID belongs to a screen that is signed in.", {
    fieldErrors: { screenId: [`“${name}” has this screen ID and is signed in. Check the ID, or replace it.`] },
    formErrors: [],
  });
}

export type ScreenSessionActivation =
  | { status: "active"; sessionId: string; expiresAt: string }
  | (ScreenSessionPollResponse & { status: "pending" });

/**
 * The pairing page's poll. One batch activates the approved pending sign-in
 * whose code the challenge proves and revokes the screen's other sign-ins.
 * The revocation only runs when this request's activation marker (a fresh
 * token hash) is in the table, so a poll that activates nothing changes
 * nothing.
 */
export async function activateScreenSession(
  db: DatabaseLike,
  screenId: string,
  challenge: { code: string; expiresAt: string },
): Promise<ScreenSessionActivation> {
  const codeHash = await screenPairingCodeHash(screenId, challenge.code);
  const marker = await sha256Hex(randomToken(32));
  const now = nowIso();
  const expiresAt = addHours(now, SCREEN_POLICY.sessionDays * 24);
  const results = await db.batch([
    db
      .prepare(
        `UPDATE screen_sessions SET activated_at=?,token_hash=?,expires_at=?,last_seen_at=?
          WHERE screen_id=? AND pairing_code_hash=? AND activated_at IS NULL AND revoked_at IS NULL AND expires_at>?`,
      )
      .bind(now, marker, expiresAt, now, screenId, codeHash, now),
    db
      .prepare(
        `UPDATE screen_sessions SET revoked_at=? WHERE screen_id=? AND revoked_at IS NULL AND token_hash<>?
          AND EXISTS(SELECT 1 FROM screen_sessions mine WHERE mine.screen_id=? AND mine.token_hash=?)`,
      )
      .bind(now, screenId, marker, screenId, marker),
    db
      .prepare(
        `SELECT id,token_hash=? AS mine,activated_at,revoked_at,expires_at FROM screen_sessions
          WHERE screen_id=? AND pairing_code_hash=? ORDER BY created_at DESC,id DESC LIMIT 1`,
      )
      .bind(marker, screenId, codeHash),
  ]);
  const row = batchFirst<{
    id: string;
    mine: number;
    activated_at: string | null;
    revoked_at: string | null;
    expires_at: string;
  }>(results[2]);
  if (row?.mine === 1) return { status: "active", sessionId: row.id, expiresAt };
  if (row && (row.activated_at || row.revoked_at))
    throw new AppError(410, "SCREEN_PAIRING_USED", "This pairing code was already used. Start pairing again.");
  if (row && row.expires_at <= now)
    throw new AppError(410, "SCREEN_PAIRING_EXPIRED", "This pairing code expired. Start pairing again.");
  return { status: "pending", expiresAt: challenge.expiresAt };
}
