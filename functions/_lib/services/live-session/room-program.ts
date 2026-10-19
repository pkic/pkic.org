import { z } from "zod";
import {
  LIVE_PROGRAM_PROTOCOL,
  LIVE_PROGRAM_MAX_CONNECTIONS,
  liveProgramMessageSchema,
  liveProgramSelectionSchema,
  liveProgramSelectSchema,
  type LiveProgramSelection,
  type LiveProgramSelectResult,
} from "../../../../assets/shared/schemas/live-room-program";
import { databaseIdSchema } from "../../../../assets/shared/schemas/identifiers";
import { liveRoomRefusalCloseCode } from "../../../../assets/shared/schemas/live-session-room";
import { resolveUserSessionClaims } from "../../auth/user-session";
import { resolveUserSessionClaimsBatch } from "../../auth/user-session-live-data";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import { hasPermission } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { Env } from "../../types";
import {
  LIVE_PROGRAM_LIFECYCLE_INTERVAL_MS,
  liveProgramPointerPurgeAt,
} from "../../../../assets/shared/live-room-program-policy";
import { utcInstantSchema } from "../../../../assets/shared/schemas/api-common";
import { nowIso } from "../../utils/time";
import { readPublishedProgramRoom } from "./program-room";
import { readLiveRoomSession } from "./room-session";
import { liveRoomName } from "./room-admission";
export const LIVE_PROGRAM_ADMISSION_HEADER = "x-pkic-live-program-admission";
export const LIVE_PROGRAM_SOCKET_TAG = "program";
export const liveProgramAdmissionSchema = z
  .object({
    eventId: databaseIdSchema,
    roomId: databaseIdSchema,
    expiresAt: z.number().int().positive(),
    sessionClaims: z.custom<UserSessionTokenClaims>().optional(),
  })
  .strict();
type Admission = z.infer<typeof liveProgramAdmissionSchema>;
const storedProgramSchema = z
  .object({
    eventId: databaseIdSchema,
    roomId: databaseIdSchema,
    selection: liveProgramSelectionSchema,
    createdAt: utcInstantSchema,
    purgeAt: z.number().int().nonnegative(),
  })
  .strict();
const KEY = "physical-room-program";
export function liveProgramName(eventId: string, roomId: string) {
  return `program:${eventId}:${roomId}`;
}
/** Only the selected occurrence pointer lives here; session DOs retain all live content. */
export class LiveRoomProgram {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}
  async exists(): Promise<boolean> {
    return (await this.ctx.storage.get(KEY)) !== undefined;
  }
  private boundValue(eventId: string, roomId: string, saved: unknown) {
    const program =
      saved === undefined
        ? {
            eventId,
            roomId,
            selection: { roomId, occurrenceId: null, revision: 0 },
            createdAt: nowIso(),
            purgeAt: liveProgramPointerPurgeAt(null, nowIso()),
          }
        : storedProgramSchema.parse(saved);
    if (program.eventId !== eventId || program.roomId !== roomId)
      throw new AppError(409, "LIVE_PROGRAM_SCOPE_CONFLICT", "This program belongs to another physical room.");
    return program;
  }
  private async bound(eventId: string, roomId: string) {
    return this.boundValue(eventId, roomId, await this.ctx.storage.get(KEY));
  }
  async read(eventId: string, roomId: string): Promise<LiveProgramSelection> {
    try {
      await readPublishedProgramRoom(this.env.DB, eventId, roomId);
    } catch (error) {
      if (error instanceof AppError && error.status === 404) await this.closeScope("LIVE_PROGRAM_ROOM_NOT_FOUND", 4404);
      throw error;
    }
    return (await this.bound(eventId, roomId)).selection;
  }
  async selectResult(
    eventId: string,
    roomId: string,
    input: z.infer<typeof liveProgramSelectSchema>,
    claims: UserSessionTokenClaims,
  ): Promise<LiveProgramSelectResult> {
    try {
      return { ok: true, selection: await this.select(eventId, roomId, input, claims) };
    } catch (error) {
      if (
        error instanceof AppError &&
        (error.status === 401 || error.status === 403 || error.status === 404 || error.status === 409)
      )
        return { ok: false, status: error.status, code: error.code, message: error.message };
      throw error;
    }
  }
  async select(
    eventId: string,
    roomId: string,
    input: z.infer<typeof liveProgramSelectSchema>,
    claims: UserSessionTokenClaims,
  ): Promise<LiveProgramSelection> {
    input = liveProgramSelectSchema.parse(input);
    const publishedRoom = await readPublishedProgramRoom(this.env.DB, eventId, roomId);
    if (input.occurrenceId) {
      const session = await readLiveRoomSession(this.env.DB, eventId, input.occurrenceId);
      if (!session.roomIds.includes(roomId))
        throw new AppError(
          409,
          "LIVE_PROGRAM_SESSION_ROOM_MISMATCH",
          "Choose a published session scheduled in this physical room.",
        );
    }
    const operator = await resolveUserSessionClaims(this.env.DB, claims);
    if (!operator.staff || !hasPermission(operator.staff, "agenda:live_moderate", { type: "event", id: eventId }))
      throw new AppError(
        403,
        "LIVE_ROOM_OPERATOR_REQUIRED",
        "Only event operators can select the active room session.",
      );
    let previousOccurrenceId: string | null = null;
    const selection = await this.ctx.storage.transaction(async (transaction) => {
      const current = this.boundValue(eventId, roomId, await transaction.get(KEY));
      previousOccurrenceId = current.selection.occurrenceId;
      if (current.selection.occurrenceId === input.occurrenceId) return current.selection;
      if (current.selection.revision !== input.expectedRevision)
        throw new AppError(
          409,
          "LIVE_PROGRAM_SELECTION_CHANGED",
          "Another operator changed the active session. Refresh before changing it.",
        );
      const selected = liveProgramSelectionSchema.parse({
        roomId,
        occurrenceId: input.occurrenceId,
        revision: current.selection.revision + 1,
      });
      await transaction.put(KEY, {
        ...current,
        selection: selected,
        purgeAt: liveProgramPointerPurgeAt(publishedRoom.lastScheduledEndAt, current.createdAt),
      });
      return selected;
    });
    // Carry room graphics into the newly active session; session-bound questions and polls stay behind.
    if (previousOccurrenceId && selection.occurrenceId && previousOccurrenceId !== selection.occurrenceId) {
      const rooms = this.env.LIVE_SESSION_ROOMS;
      if (rooms) {
        const stage = await rooms.getByName(liveRoomName(eventId, previousOccurrenceId)).programStage();
        await rooms.getByName(liveRoomName(eventId, selection.occurrenceId)).adoptProgramStage(stage);
      }
    }
    await this.broadcast(selection);
    return selection;
  }
  async connect(request: Request): Promise<Response> {
    const admission = liveProgramAdmissionSchema.parse(
      JSON.parse(request.headers.get(LIVE_PROGRAM_ADMISSION_HEADER) ?? ""),
    );
    const program = await this.bound(admission.eventId, admission.roomId);
    const publishedRoom = await readPublishedProgramRoom(this.env.DB, admission.eventId, admission.roomId);
    program.purgeAt = liveProgramPointerPurgeAt(publishedRoom.lastScheduledEndAt, program.createdAt);
    if (this.ctx.getWebSockets(LIVE_PROGRAM_SOCKET_TAG).length >= LIVE_PROGRAM_MAX_CONNECTIONS)
      throw new AppError(
        429,
        "LIVE_PROGRAM_CONNECTION_LIMIT",
        "This physical room has reached its source connection limit.",
      );
    await this.ctx.storage.put(KEY, program);
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [LIVE_PROGRAM_SOCKET_TAG]);
    server.serializeAttachment(admission);
    const allowed = await this.authorized([server]);
    if (allowed.includes(server))
      server.send(
        JSON.stringify(liveProgramMessageSchema.parse({ type: "program.snapshot", selection: program.selection })),
      );
    await this.scheduleExpiry();
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": LIVE_PROGRAM_PROTOCOL },
    });
  }
  private async authorized(sockets: WebSocket[]): Promise<WebSocket[]> {
    sockets = sockets.filter((s) => s.readyState === WebSocket.OPEN);
    const admissions = sockets.map((s) => liveProgramAdmissionSchema.parse(s.deserializeAttachment()));
    const staff = admissions.filter((a) => a.sessionClaims).map((a) => a.sessionClaims!);
    let results: Awaited<ReturnType<typeof resolveUserSessionClaimsBatch>>;
    try {
      results = await resolveUserSessionClaimsBatch(this.env.DB, staff);
    } catch (error) {
      for (const socket of sockets) {
        try {
          socket.close(1011, "Program availability could not be verified");
        } catch {
          /* Already closed. */
        }
      }
      throw error;
    }
    let index = 0;
    return sockets.filter((socket, position) => {
      const admission = admissions[position];
      let allowed = admission.expiresAt > Date.now() / 1000;
      if (admission.sessionClaims) {
        const result = results[index++];
        allowed =
          allowed &&
          result.ok &&
          result.session.staff !== undefined &&
          hasPermission(result.session.staff, "agenda:live_moderate", { type: "event", id: admission.eventId });
      }
      if (!allowed) {
        try {
          socket.close(liveRoomRefusalCloseCode(403), "LIVE_PROGRAM_ACCESS_EXPIRED");
        } catch {
          /* Already closed. */
        }
      }
      return allowed;
    });
  }
  private async broadcast(selection: LiveProgramSelection): Promise<void> {
    const sockets = await this.authorized(this.ctx.getWebSockets(LIVE_PROGRAM_SOCKET_TAG));
    const payload = JSON.stringify(liveProgramMessageSchema.parse({ type: "program.changed", selection }));
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        socket.send(payload);
      } catch {
        /* Already closed. */
      }
    }
    await this.scheduleExpiry();
  }
  private async closeScope(reason: string, code: number): Promise<void> {
    const saved = await this.ctx.storage.get(KEY);
    const program = saved === undefined ? null : storedProgramSchema.parse(saved);
    for (const socket of this.ctx.getWebSockets(LIVE_PROGRAM_SOCKET_TAG)) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      try {
        if (program)
          socket.send(
            JSON.stringify(
              liveProgramMessageSchema.parse({
                type: "program.changed",
                selection: { ...program.selection, occurrenceId: null, revision: program.selection.revision + 1 },
              }),
            ),
          );
        socket.close(code, reason);
      } catch {
        /* Already closed. */
      }
    }
    await this.ctx.storage.delete(KEY);
    await this.ctx.storage.deleteAlarm();
  }
  async alarm(): Promise<void> {
    const saved = await this.ctx.storage.get(KEY);
    if (saved === undefined) return;
    const program = storedProgramSchema.parse(saved);
    try {
      const publishedRoom = await readPublishedProgramRoom(this.env.DB, program.eventId, program.roomId);
      const purgeAt = liveProgramPointerPurgeAt(publishedRoom.lastScheduledEndAt, program.createdAt);
      if (Date.now() >= purgeAt) return this.closeScope("LIVE_PROGRAM_ENDED", 1000);
      if (program.selection.occurrenceId) {
        let valid = true;
        try {
          const session = await readLiveRoomSession(this.env.DB, program.eventId, program.selection.occurrenceId);
          valid = session.roomIds.includes(program.roomId);
        } catch (error) {
          if (error instanceof AppError && error.status === 404) valid = false;
          else throw error;
        }
        if (!valid) {
          const cleared = await this.ctx.storage.transaction(async (transaction) => {
            const current = this.boundValue(program.eventId, program.roomId, await transaction.get(KEY));
            if (current.selection.occurrenceId !== program.selection.occurrenceId) return current.selection;
            const selection = liveProgramSelectionSchema.parse({
              ...current.selection,
              occurrenceId: null,
              revision: current.selection.revision + 1,
            });
            await transaction.put(KEY, { ...current, selection, purgeAt });
            return selection;
          });
          await this.broadcast(cleared);
        }
      }
      const current = await this.bound(program.eventId, program.roomId);
      await this.ctx.storage.put(KEY, { ...current, purgeAt });
      await this.authorized(this.ctx.getWebSockets(LIVE_PROGRAM_SOCKET_TAG));
      await this.scheduleExpiry();
    } catch (error) {
      if (error instanceof AppError && error.status === 404)
        return this.closeScope("LIVE_PROGRAM_ROOM_NOT_FOUND", 4404);
      for (const socket of this.ctx.getWebSockets(LIVE_PROGRAM_SOCKET_TAG)) {
        try {
          socket.close(1011, "Program availability could not be verified");
        } catch {
          /* Already closed. */
        }
      }
      await this.ctx.storage.setAlarm(Date.now() + LIVE_PROGRAM_LIFECYCLE_INTERVAL_MS);
      throw error;
    }
  }
  private async scheduleExpiry(): Promise<void> {
    const expiry = this.ctx
      .getWebSockets(LIVE_PROGRAM_SOCKET_TAG)
      .filter((socket) => socket.readyState === WebSocket.OPEN)
      .map((socket) => (socket.deserializeAttachment() as Admission).expiresAt * 1000)
      .filter((at) => at > Date.now());
    const saved = await this.ctx.storage.get(KEY);
    if (saved === undefined) return;
    const program = storedProgramSchema.parse(saved);
    const due = [
      program.purgeAt,
      ...expiry,
      ...(expiry.length ? [Date.now() + LIVE_PROGRAM_LIFECYCLE_INTERVAL_MS] : []),
    ];
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...due)));
  }
}
