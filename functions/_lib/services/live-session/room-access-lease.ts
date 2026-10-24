import { LIVE_ROOM_ACCESS_POLICY } from "../../../../assets/shared/live-session-policy";
import { AppError } from "../../errors";
import type { Env } from "../../types";
import { liveRoomAccessGrantSchema, type LiveRoomParticipant } from "./room-admission";
import { loadLiveRoomCommandRead } from "./room-command-read";
import {
  liveParticipantReadKey,
  runWithLiveRoomCommandRead,
  type LiveRoomCommandRead,
  type LiveParticipantReadResult,
} from "./room-command-read-scope";
import { LIVE_PROGRAM_SOCKET_TAG } from "./room-program";
import { liveRoomRefusalCloseCode } from "../../../../assets/shared/schemas/live-session-room";
import { authorizeLiveRoomRecipients } from "./room-recipients";
import { closeLiveRoomSocket } from "./room-socket-close";
import type { LiveRoomSql } from "./room-sql";

type Room = { eventId: string; session: { occurrenceId: string } };

/** Connection leases survive hibernation in socket attachments; only the alarm refreshes D1 access. */
export class LiveRoomAccessLease {
  private readonly admitting = new WeakSet<WebSocket>();
  private refreshing: Promise<void> | undefined;
  private readonly scopes = new Set<LiveRoomCommandRead>();

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Pick<Env, "DB" | "LIVE_SESSION_ROOMS">,
    private readonly sql: LiveRoomSql,
    private readonly room: () => Room | null,
    private readonly candidates: () => string[],
    private readonly onErased: (userId: string) => Promise<void>,
  ) {}

  private sockets(): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter(
        (socket) => socket.readyState === WebSocket.OPEN && !this.ctx.getTags(socket).includes(LIVE_PROGRAM_SOCKET_TAG),
      );
  }

  private erased(): Set<string> {
    return new Set(
      this.sql.rows<{ user_id: string }>("SELECT user_id FROM room_access_erasures").map((row) => row.user_id),
    );
  }

  /** Privacy erasure takes effect locally even if a background D1 read is already in flight. */
  forget(userId: string): void {
    this.sql.exec("INSERT OR IGNORE INTO room_access_erasures(user_id) VALUES(?)", userId);
    for (const scope of this.scopes) scope.erased.add(userId);
  }

  nextRefreshAt(): number | null {
    const sockets = this.sockets();
    if (!sockets.length) return null;
    return Math.min(
      ...sockets.map((socket) => {
        const grant = liveRoomAccessGrantSchema.safeParse(
          (socket.deserializeAttachment() as LiveRoomParticipant).accessGrant,
        );
        return grant.success
          ? Date.parse(grant.data.checkedAt) + LIVE_ROOM_ACCESS_POLICY.refreshMilliseconds
          : Date.now();
      }),
    );
  }

  async admit(socket: WebSocket): Promise<void> {
    this.admitting.add(socket);
    try {
      await this.refresh();
    } catch (error) {
      closeLiveRoomSocket(socket, 1011, "Room admission unavailable");
      throw error;
    } finally {
      this.admitting.delete(socket);
    }
  }

  authorize(sockets: WebSocket[]): Promise<WebSocket[]> {
    return Promise.resolve(this.eligible(sockets));
  }

  eligible(sockets: WebSocket[]): WebSocket[] {
    const erased = this.erased();
    return sockets.filter((socket) => {
      if (socket.readyState !== WebSocket.OPEN || this.admitting.has(socket)) return false;
      const result = this.result(socket.deserializeAttachment() as LiveRoomParticipant, erased, Date.now());
      if (result.ok) return true;
      closeLiveRoomSocket(socket, liveRoomRefusalCloseCode(result.error.status), result.error.code);
      return false;
    });
  }

  private result(viewer: LiveRoomParticipant, erased: Set<string>, now: number): LiveParticipantReadResult {
    const parsed = liveRoomAccessGrantSchema.safeParse(viewer.accessGrant);
    if (viewer.userId && erased.has(viewer.userId))
      return { ok: false, error: new AppError(401, "AUTH_INVALID", "This account is no longer active.") };
    if (parsed.success && Date.parse(parsed.data.credentialExpiresAt) <= now)
      return { ok: false, error: new AppError(401, "AUTH_EXPIRED", "Your session expired. Sign in again.") };
    if (
      !parsed.success ||
      parsed.data.key !== liveParticipantReadKey(viewer) ||
      Date.parse(parsed.data.checkedAt) + LIVE_ROOM_ACCESS_POLICY.leaseMilliseconds <= now
    )
      return {
        ok: false,
        error: new AppError(503, "LIVE_ROOM_ACCESS_EXPIRED", "Reconnect to refresh your room access."),
      };
    return { ok: true, participant: viewer, expiresAt: Date.parse(parsed.data.credentialExpiresAt) };
  }

  /** Admission and the single room alarm own refresh; overlapping joins share one in-flight refresh. */
  async refresh(): Promise<void> {
    if (this.refreshing) {
      await this.refreshing;
      // A socket admitted while the read was pending needs its own canonical basis.
      if (this.sockets().every((socket) => (socket.deserializeAttachment() as LiveRoomParticipant).accessGrant)) return;
      return this.refresh();
    }
    this.refreshing = this.read();
    try {
      await this.refreshing;
    } finally {
      this.refreshing = undefined;
    }
  }

  private async read(): Promise<void> {
    const room = this.room(),
      sockets = this.sockets();
    if (!room || !sockets.length) return;
    const checkedAt = Date.now();
    const viewers = sockets.map((socket) => socket.deserializeAttachment() as LiveRoomParticipant);
    const candidates = [
      ...new Set([...this.candidates(), ...viewers.flatMap((viewer) => (viewer.userId ? [viewer.userId] : []))]),
    ];
    const read = await loadLiveRoomCommandRead(
      this.env.DB,
      this.env.LIVE_SESSION_ROOMS,
      room,
      viewers,
      viewers,
      candidates,
    );
    if (checkedAt + LIVE_ROOM_ACCESS_POLICY.leaseMilliseconds <= Date.now())
      throw new AppError(503, "LIVE_ROOM_ACCESS_EXPIRED", "Room access could not refresh in time.");
    const previous = this.erased();
    const newlyErased = [...read.erased].filter((id) => !previous.has(id));
    for (const userId of read.erased) this.forget(userId);
    for (const userId of this.erased()) read.erased.add(userId);
    for (const [key, result] of read.participants) {
      if (result.ok && result.participant.userId && read.erased.has(result.participant.userId))
        read.participants.set(key, {
          ok: false,
          error: new AppError(401, "AUTH_INVALID", "This account is no longer active."),
        });
    }
    const eligible = await runWithLiveRoomCommandRead(read, () => authorizeLiveRoomRecipients(this.env, room, sockets));
    for (const socket of eligible) {
      const participant = socket.deserializeAttachment() as LiveRoomParticipant;
      const key = liveParticipantReadKey(participant),
        result = read.participants.get(key);
      if (!result?.ok) continue;
      socket.serializeAttachment({
        ...participant,
        accessGrant: {
          key,
          checkedAt: new Date(checkedAt).toISOString(),
          credentialExpiresAt: new Date(result.expiresAt).toISOString(),
          author: read.authors.get(key) ?? { affiliation: null, roles: [] },
        },
      });
    }
    for (const userId of newlyErased) await this.onErased(userId);
  }

  /** Never await D1 on a message or broadcast. A missing/expired lease refuses access until readmission. */
  async run<T>(work: () => Promise<T>): Promise<T> {
    const room = this.room();
    if (!room) return work();
    const erased = this.erased();
    const read: LiveRoomCommandRead = {
      active: true,
      eventId: room.eventId,
      occurrenceId: room.session.occurrenceId,
      participants: new Map(),
      authors: new Map(),
      erased,
      erasureCandidates: new Set([...this.candidates(), ...erased]),
    };
    const now = Date.now();
    for (const socket of this.sockets()) {
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
      const key = liveParticipantReadKey(viewer);
      const result = this.result(viewer, erased, now);
      if (result.ok && viewer.accessGrant) read.authors.set(key, viewer.accessGrant.author);
      read.participants.set(key, result);
      if (viewer.userId) read.erasureCandidates.add(viewer.userId);
    }
    this.scopes.add(read);
    try {
      return await runWithLiveRoomCommandRead(read, work);
    } finally {
      this.scopes.delete(read);
    }
  }
}
