import type { LiveTickerContext } from "../../../../assets/shared/schemas/live-session-ticker";
import type { LiveOverlayLayoutGeometry } from "../../../../assets/shared/schemas/live-overlay-layout";
import type { DatabaseLike } from "../../types";
import type { LiveChatRemoval } from "./room-chat";
import { liveChatChannelVisible, type LiveChatFeed } from "./room-chat-feed";
import { chatAudienceKey, seesChatOccurrence } from "./room-chat-audience";
import {
  EMPTY_LIVE_AUX_COMPOSITION,
  EMPTY_LIVE_OUTPUTS,
  type LiveRoomServerMessage,
  type LiveRoomSession,
} from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomParticipant } from "./room-admission";
import type { CustomAnswerValue } from "../../../../assets/shared/form-answer-rules";
import type { LivePollStore } from "./room-poll-store";
import { projectLivePreparedQuestion, type LivePreparedQuestionStore } from "./room-prepared-question-store";
import {
  projectLivePoll,
  projectLiveQuestion,
  serializeLiveRoomMessage,
  type LiveQuestionAuthor,
} from "./room-projection";
import type { LiveQuestionRow } from "./room-question-rows";
import type { LiveRoomStore } from "./room-store";
import { seesStageDisplayNext } from "../../../../assets/shared/live-stage-display";
import { NO_LIVE_ROOM_SOURCES, type LiveRoomSources } from "../../../../assets/shared/schemas/live-room-sources";
import { DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS } from "../../../../assets/shared/schemas/live-stage-display-settings";
import { DEFAULT_LIVE_SCREEN_SYNC } from "../../../../assets/shared/schemas/live-screen-sync";

const EMPTY_QUEUE = { question: [], "lower-third": [], poll: [], change: null };

/** Attendees see Program on their own screens; the room's other outputs are for the stage and its crew. */
function seesRoomOutputs(viewer: LiveRoomParticipant): boolean {
  return viewer.studio === true || viewer.role === "overlay" || viewer.role === "speaker";
}

function seesSpeakerMessage(viewer: LiveRoomParticipant): boolean {
  return viewer.role === "speaker" || viewer.role === "overlay" || viewer.studio === true;
}

function roomOutputMessage(message: LiveRoomServerMessage): boolean {
  return (
    message.type === "aux.changed" ||
    message.type === "stage.display.settings.changed" ||
    message.type === "screen.sync.changed"
  );
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
    private readonly prepared: LivePreparedQuestionStore,
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
    const studio = viewer.studio === true;
    return serializeLiveRoomMessage({
      type: "room.snapshot",
      overlayLayouts: this.overlayLayouts(),
      tickerContext: this.tickerContext(),
      session,
      viewer: {
        role: viewer.role,
        name: viewer.name,
        organizer: viewer.organizer ?? false,
        participation: viewer.role === "operator" ? null : this.chat.decisions.restriction(viewer.userId, Date.now()),
      },
      questions: this.questionsFor(viewer, voted),
      polls: this.polls
        .polls()
        .flatMap(
          (poll) => projectLivePoll(poll, viewer, answers.get(poll.id) ?? null, this.store.pollOnAir(poll.id)) ?? [],
        ),
      preparedQuestions: studio ? this.prepared.list().map(projectLivePreparedQuestion) : [],
      preparedQuestionWindow: studio ? this.prepared.window(session) : null,
      overlayMode: this.store.overlayMode(),
      stage,
      outputs: seesRoomOutputs(viewer) ? this.store.outputs() : EMPTY_LIVE_OUTPUTS,
      speakerMessage: seesSpeakerMessage(viewer) ? this.store.speakerMessage() : null,
      preview: studio ? this.store.preview() : EMPTY_LIVE_AUX_COMPOSITION,
      timers: this.store.timers(),
      reactionTotals: this.store.reactionTotals(),
      queue: studio ? this.store.queue() : EMPTY_QUEUE,
      operators: operator ? this.operators(undefined, eligible) : [],
      addedCredits: studio ? this.store.addedCredits() : [],
      stageDisplayNext: seesStageDisplayNext(viewer) ? this.store.preview().question : null,
      stageDisplayNextVotes: seesStageDisplayNext(viewer) ? this.nextVotes() : null,
      stageDisplaySettings: seesRoomOutputs(viewer)
        ? this.store.stageDisplaySettings()
        : DEFAULT_LIVE_STAGE_DISPLAY_SETTINGS,
      screenSync: seesRoomOutputs(viewer) ? this.store.screenSync() : DEFAULT_LIVE_SCREEN_SYNC,
      opening: this.store.opening(),
      movedOn: this.store.movedOn(),
      sources: studio ? this.sources() : NO_LIVE_ROOM_SOURCES,
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
    // The stage display shows the next question's votes as they come in.
    if (this.store.preview().question?.id === questionId) await this.stageDisplayNext();
  }

  /** The votes of the question lined up in Preview, or null when none is. */
  private nextVotes(): number | null {
    const next = this.store.preview().question;
    return next ? (this.store.question(next.id)?.votes ?? null) : null;
  }

  /** Tells the stage display sources the question lined up next, with its votes. */
  private async stageDisplayNext(): Promise<void> {
    const next = {
      type: "stage.display.next.changed",
      question: this.store.preview().question,
      votes: this.nextVotes(),
    } as const;
    for (const socket of this.ctx.getWebSockets("overlay"))
      if (seesStageDisplayNext(socket.deserializeAttachment() as LiveRoomParticipant))
        await this.send(() => next, null, socket);
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

  /** How many read-only sources draw each output now; `leaving` is a socket that is closing. */
  sources(leaving?: WebSocket): LiveRoomSources {
    const sources: Record<string, number> = { ...NO_LIVE_ROOM_SOURCES };
    for (const socket of this.ctx.getWebSockets("overlay")) {
      if (socket === leaving || socket.readyState !== WebSocket.OPEN) continue;
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
      if (viewer.role !== "overlay") continue;
      const output = viewer.overlayOutput ?? "program";
      sources[output] = (sources[output] ?? 0) + 1;
    }
    return sources;
  }

  async sourcesChanged(leaving?: WebSocket): Promise<void> {
    const sources = this.sources(leaving);
    await this.send(
      (viewer) => (viewer.studio ? { type: "sources.changed", sources } : null),
      (viewer) => String(viewer.studio === true),
    );
  }

  async operatorsChanged(leaving?: WebSocket): Promise<void> {
    await this.send(
      (viewer, sockets) =>
        viewer.role === "operator" ? { type: "operators.changed", operators: this.operators(leaving, sockets) } : null,
      (viewer) => viewer.role,
    );
  }

  /**
   * A message that reads the same for its whole audience; queue, Preview,
   * prepared-question and added-people changes reach operators only, and the room's other outputs never reach attendees.
   */
  async all(message: LiveRoomServerMessage): Promise<void> {
    const studioOnly =
      message.type === "queue.changed" ||
      message.type === "preview.changed" ||
      message.type === "credits.added.changed" ||
      message.type === "program.cleared" ||
      message.type === "question.prepared.changed";
    const speakerOnly = message.type === "speaker.message.changed";
    const roomOutput = roomOutputMessage(message);
    await this.send(
      (viewer) =>
        (studioOnly && !viewer.studio) ||
        (speakerOnly && !seesSpeakerMessage(viewer)) ||
        (roomOutput && !seesRoomOutputs(viewer))
          ? null
          : message,
      studioOnly || speakerOnly || roomOutput ? null : (viewer) => viewer.role,
    );
    // Preview's question also reaches the stage display, as the speaker's next one; operators read it from Preview.
    if (message.type === "preview.changed") await this.stageDisplayNext();
  }

  async chatRemoved(removal: LiveChatRemoval): Promise<void> {
    await this.send(
      (viewer) =>
        liveChatChannelVisible(removal.channel, viewer) && seesChatOccurrence(viewer, removal.occurrence_id)
          ? { type: "chat.removed", messageId: removal.id, channel: removal.channel }
          : null,
      chatAudienceKey,
    );
  }

  private sendChatRemovals(removed: readonly LiveChatRemoval[], sockets: WebSocket[]): void {
    if (!removed.length) return;
    for (const socket of sockets) {
      if (
        socket.readyState !== WebSocket.OPEN ||
        (socket.deserializeAttachment() as LiveRoomParticipant).role === "overlay"
      )
        continue;
      for (const removal of removed) {
        const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
        if (!liveChatChannelVisible(removal.channel, viewer) || !seesChatOccurrence(viewer, removal.occurrence_id))
          continue;
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
