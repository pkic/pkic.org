import type { LiveTickerContext } from "../../../../assets/shared/schemas/live-session-ticker";
import type { LiveOverlayLayoutGeometry } from "../../../../assets/shared/schemas/live-overlay-layout";
import type { DatabaseLike } from "../../types";
import type { LiveChatRemoval } from "./room-chat";
import { liveChatChannelVisible, type LiveChatFeed } from "./room-chat-feed";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveRoomServerMessage,
  type LiveRoomSession,
} from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomParticipant } from "./room-admission";
import type { CustomAnswerValue } from "../../../../assets/shared/form-answer-rules";
import type { LivePollStore } from "./room-poll-store";
import {
  projectLivePoll,
  projectLiveQuestion,
  serializeLiveRoomMessage,
  type LiveQuestionAuthor,
} from "./room-projection";
import type { LiveQuestionRow, LiveRoomStore } from "./room-store";
import { seesStageDisplayNext } from "../../../../assets/shared/live-stage-display";

const EMPTY_QUEUE = { question: [], "lower-third": [], poll: [], change: null };

/** Attendees see Program on their own screens; the room's other outputs are for the stage and its crew. */
function seesRoomOutputs(viewer: LiveRoomParticipant): boolean {
  return viewer.role !== "attendee";
}

function roomOutputMessage(message: LiveRoomServerMessage): boolean {
  return message.type === "aux.changed" || message.type === "speaker.message.changed";
}

/**
 * Tells each connected viewer what changed, as that viewer may see it. A
 * message is serialized once per distinct audience, not once per socket.
 */
export class LiveRoomBroadcast {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly store: LiveRoomStore,
    private readonly polls: LivePollStore,
    private readonly chat: LiveChatFeed,
    private readonly db: DatabaseLike,
    private readonly authorize: (sockets: WebSocket[]) => Promise<WebSocket[]>,
    private readonly overlayLayouts: () => LiveOverlayLayoutGeometry[],
    private readonly tickerContext: () => LiveTickerContext,
    private readonly withAccess: <T>(work: () => Promise<T>) => Promise<T>,
  ) {}

  /** The full room for one viewer as they join. */
  async snapshot(socket: WebSocket, session: LiveRoomSession): Promise<string | null> {
    return this.withAccess(() => this.admittedSnapshot(socket, session));
  }

  private async admittedSnapshot(socket: WebSocket, session: LiveRoomSession): Promise<string | null> {
    const removedChat = await this.chat.eraseAnonymizedAuthors(this.db);
    const eligible = await this.authorize(this.ctx.getWebSockets());
    this.sendChatRemovals(removedChat, eligible);
    if (!eligible.includes(socket) || socket.readyState !== WebSocket.OPEN) return null;
    const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
    const voted = viewer.userId ? this.store.votedQuestionIds(viewer.userId) : new Set<string>();
    const answers = viewer.userId ? this.polls.answers(viewer.userId) : new Map<string, CustomAnswerValue>();
    const stage = this.store.stage();
    const operator = viewer.role === "operator";
    return serializeLiveRoomMessage({
      type: "room.snapshot",
      overlayLayouts: this.overlayLayouts(),
      tickerContext: this.tickerContext(),
      session,
      viewer: {
        role: viewer.role,
        name: viewer.name,
        organizer: viewer.organizer ?? false,
        chatRestriction: this.chat.moderation.restriction(viewer.userId),
      },
      questions: this.questionsFor(viewer, voted),
      polls: this.polls
        .polls()
        .flatMap(
          (poll) => projectLivePoll(poll, viewer, answers.get(poll.id) ?? null, this.store.pollOnAir(poll.id)) ?? [],
        ),
      overlayMode: this.store.overlayMode(),
      ...this.chat.snapshot(viewer),
      stage,
      outputs: seesRoomOutputs(viewer) ? this.store.outputs() : EMPTY_LIVE_OUTPUTS,
      speakerMessage: seesRoomOutputs(viewer) ? this.store.speakerMessage() : null,
      preview: operator ? this.store.preview() : EMPTY_LIVE_AUX_COMPOSITION,
      timers: this.store.timers(session),
      reactionTotals: this.store.reactionTotals(),
      queue: operator ? this.store.queue() : EMPTY_QUEUE,
      operators: operator ? this.operators(undefined, eligible) : [],
      addedCredits: operator ? this.store.addedCredits() : [],
      stageDisplayNext: seesStageDisplayNext(viewer) ? this.store.preview().question : null,
    });
  }

  /** Each viewer receives the question as they may see it, or its removal when they no longer may. */
  async question(questionId: string): Promise<void> {
    const row = this.store.question(questionId);
    if (!row) return;
    const author = this.questionAuthors([row]).get(row.id) ?? null;
    await this.send((viewer) => {
      if (viewer.role === "overlay") return null;
      const question = projectLiveQuestion(
        row,
        viewer,
        viewer.userId ? this.store.hasVoted(row.id, viewer.userId) : false,
        author,
      );
      return question ? { type: "question.changed", question } : { type: "question.removed", questionId };
    }, null);
  }

  private questionsFor(viewer: LiveRoomParticipant, voted: ReadonlySet<string>) {
    const rows = this.store.questions();
    const authors = this.questionAuthors(rows);
    return rows.flatMap(
      (row) => projectLiveQuestion(row, viewer, voted.has(row.id), authors.get(row.id) ?? null) ?? [],
    );
  }

  /** Each question's author as the room shows them: handle, the capacity they asked in and their roles. */
  private questionAuthors(rows: readonly LiveQuestionRow[]): Map<string, LiveQuestionAuthor> {
    const people = this.chat.people.people(rows.map((row) => row.author_user_id));
    const stamps = this.chat.authors.questionStamps(rows.map((row) => row.id));
    return new Map(
      rows.map((row) => {
        const person = people.get(row.author_user_id);
        return [
          row.id,
          {
            handle: person?.handle ?? null,
            affiliation: stamps.get(row.id)?.affiliation ?? null,
            roles: stamps.get(row.id)?.roles ?? [],
          },
        ];
      }),
    );
  }

  /**
   * Each viewer receives the poll as they may see it: a draft only reaches
   * operators, tallies follow the setting. Viewers with the same role and the
   * same answer share one payload.
   */
  async poll(pollId: string, only?: WebSocket): Promise<void> {
    const poll = this.polls.poll(pollId);
    if (!poll) return;
    const ballots = this.polls.ballots(pollId);
    const onAir = this.store.pollOnAir(pollId);
    await this.send(
      (viewer) => {
        const ballot = (viewer.userId && ballots.get(viewer.userId)) || null;
        const projected = projectLivePoll(
          poll,
          viewer,
          ballot ? (JSON.parse(ballot) as CustomAnswerValue) : null,
          onAir,
        );
        return projected ? { type: "poll.changed", poll: projected } : { type: "poll.removed", pollId };
      },
      (viewer) => `${viewer.role}:${(viewer.userId && ballots.get(viewer.userId)) || ""}`,
      only,
    );
  }

  /** The operators connected now, one entry per person; `leaving` is a socket that is closing. */
  operators(leaving?: WebSocket, eligible?: WebSocket[]): Array<{ name: string; connections: number }> {
    const people = new Map<string, { name: string; connections: number }>();
    for (const socket of eligible ?? this.ctx.getWebSockets("operator")) {
      if (socket === leaving || socket.readyState !== WebSocket.OPEN) continue;
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
      if (viewer.role !== "operator") continue;
      const key = viewer.userId ?? "";
      const entry = people.get(key) ?? { name: viewer.name ?? "Operator", connections: 0 };
      entry.connections += 1;
      people.set(key, entry);
    }
    return [...people.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  async operatorsChanged(leaving?: WebSocket): Promise<void> {
    await this.send(
      (viewer, sockets) =>
        viewer.role === "operator" ? { type: "operators.changed", operators: this.operators(leaving, sockets) } : null,
      (viewer) => viewer.role,
    );
  }

  /**
   * A message that reads the same for its whole audience; queue, Preview and
   * added-people changes reach operators only, and the room's other outputs never reach attendees.
   */
  async all(message: LiveRoomServerMessage): Promise<void> {
    const operatorsOnly =
      message.type === "queue.changed" ||
      message.type === "preview.changed" ||
      message.type === "credits.added.changed" ||
      message.type === "program.cleared";
    const roomOutput = roomOutputMessage(message);
    const banned = message.type === "chat.removed" ? this.chat.banned() : new Set<string>();
    await this.send(
      (viewer) =>
        (operatorsOnly && viewer.role !== "operator") ||
        (roomOutput && !seesRoomOutputs(viewer)) ||
        (message.type === "chat.removed" && !liveChatChannelVisible(message.channel, viewer, banned))
          ? null
          : message,
      (viewer) =>
        message.type === "chat.removed"
          ? `${viewer.role}:${viewer.userId !== null && banned.has(viewer.userId)}`
          : operatorsOnly || roomOutput
            ? viewer.role
            : "all",
    );
    // Preview's question also reaches the stage display, as the speaker's next one; operators read it from Preview.
    if (message.type !== "preview.changed") return;
    const next = { type: "stage.display.next.changed", question: message.composition.question } as const;
    for (const socket of this.ctx.getWebSockets("overlay"))
      if (seesStageDisplayNext(socket.deserializeAttachment() as LiveRoomParticipant))
        await this.send(() => next, null, socket);
  }

  private sendChatRemovals(removed: readonly LiveChatRemoval[], sockets: WebSocket[]): void {
    if (!removed.length) return;
    const banned = this.chat.banned();
    for (const socket of sockets) {
      if (
        socket.readyState !== WebSocket.OPEN ||
        (socket.deserializeAttachment() as LiveRoomParticipant).role === "overlay"
      )
        continue;
      for (const removal of removed) {
        const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
        if (!liveChatChannelVisible(removal.channel, viewer, banned)) continue;
        try {
          socket.send(
            serializeLiveRoomMessage({ type: "chat.removed", messageId: removal.id, channel: removal.channel }),
          );
        } catch {
          /* Already closed. */
        }
      }
    }
  }

  /**
   * Sends each viewer its message. `audience` names the viewers who receive
   * the same bytes, so a payload is serialized once per audience; it must
   * fully decide the message. Null serializes per socket.
   */
  async send(
    messageFor: (viewer: LiveRoomParticipant, sockets: WebSocket[]) => LiveRoomServerMessage | null,
    audience: ((viewer: LiveRoomParticipant) => string) | null,
    only?: WebSocket | WebSocket[],
  ): Promise<void> {
    return this.withAccess(() => this.sendAdmitted(messageFor, audience, only));
  }

  private async sendAdmitted(
    messageFor: (viewer: LiveRoomParticipant, sockets: WebSocket[]) => LiveRoomServerMessage | null,
    audience: ((viewer: LiveRoomParticipant) => string) | null,
    only?: WebSocket | WebSocket[],
  ): Promise<void> {
    const removedChat = await this.chat.eraseAnonymizedAuthors(this.db);
    const sockets = await this.authorize(only ? (Array.isArray(only) ? only : [only]) : this.ctx.getWebSockets());
    this.sendChatRemovals(removedChat, sockets);
    const shared = new Map<string, string>();
    for (const socket of sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
      const key = audience?.(viewer) ?? null;
      let payload = key === null ? null : (shared.get(key) ?? null);
      if (payload === null) {
        const message = messageFor(viewer, sockets);
        if (!message) continue;
        payload = serializeLiveRoomMessage(message);
        if (key !== null) shared.set(key, payload);
      }
      try {
        socket.send(payload);
      } catch {
        // A socket closing mid-broadcast is cleaned up by its close handler.
      }
    }
  }
}
