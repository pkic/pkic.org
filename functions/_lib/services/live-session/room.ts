import { AppError } from "../../errors";
import { LiveRoomEngagement } from "./room-engagement";
import { LiveRoomAnswers } from "./room-answers";
import { LiveRoomAnswerStore } from "./room-answer-store";
import { LiveRoomModerationStore } from "./room-moderation-store";
import { LiveRoomParticipation } from "./room-participation";
import { LIVE_PARTICIPATION_REFUSAL, liveCommandParticipates } from "./room-participation-refusal";
import { LiveRoomQuestionCommands } from "./room-question-commands";
import { operateLiveDesk, type LiveDesk } from "./room-desk";
import { LiveRoomGraphics } from "./room-graphics";
import { LiveRoomGraphicBasis } from "./room-graphic-basis";
import { LiveRoomOnScreenLists } from "./room-on-screen-lists";
import { LIVE_TICKER_REFRESH_MS, liveChatTickerLines } from "./room-ticker";
import { LiveRoomProgram, LIVE_PROGRAM_SOCKET_TAG, closeLiveRoomProgramSources } from "./room-program";
import type {
  LiveProgramSelection,
  LiveProgramSelectResult,
} from "../../../../assets/shared/schemas/live-room-program";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import type { z } from "zod";
import type { liveProgramSelectSchema } from "../../../../assets/shared/schemas/live-room-program";
import { LiveRoomChat, type LiveChatArchiveRow } from "./room-chat";
import { liveChatErasable, purgeLiveRoom } from "./room-purge";
import { LiveRoomChatActions } from "./room-chat-actions";
import { LiveChatFeed } from "./room-chat-feed";
import { LiveChatModerationStore } from "./room-chat-moderation";
import { LiveChatReactionStore } from "./room-chat-reactions";
import { LiveRoomPeople } from "./room-people";
import { LiveRoomAuthors } from "./room-authors";
import { LiveRoomQuestions } from "./room-questions";
import { DurableObject } from "cloudflare:workers";
import {
  LIVE_ROOM_POLICY,
  liveRoomOpen,
  liveRoomPurgeAt,
  liveRoomTakesQuestions,
} from "../../../../assets/shared/live-session-policy";
import {
  LIVE_ROOM_PROTOCOL,
  type LiveRoomClientMessage,
  type LiveRoomSession,
  type LiveStage,
} from "../../../../assets/shared/schemas/live-session-room";
import type { Env, LiveSessionRoomRpc } from "../../types";
import { LiveRoomAccessLease } from "./room-access-lease";
import { runLiveRoomAlarm } from "./room-alarm";
import { closeLiveRoomSocket } from "./room-socket-close";
import { liveRoomRefusalCloseCode } from "../../../../assets/shared/schemas/live-session-room";
import { nowIso } from "../../utils/time";
import { LIVE_ROOM_ADMISSION_HEADER, liveRoomAdmissionSchema, type LiveRoomParticipant } from "./room-admission";
import { LiveRoomBroadcast } from "./room-broadcast";
import { LiveRoomControls, type LiveControlOutcome, type LiveRefusal } from "./room-controls";
import { LiveRoomTimers } from "./room-timers";
import { LivePollStore } from "./room-poll-store";
import { LivePreparedQuestionStore } from "./room-prepared-question-store";
import { LiveRoomPreparedQuestions } from "./room-prepared-questions";
import { LiveRoomPolls } from "./room-polls";
import { parseLiveRoomMessage, serializeLiveRoomMessage } from "./room-projection";
import { LiveRoomSql } from "./room-sql";
import { LiveRoomDatabaseSession } from "./room-database-session";
import { LiveRoomStore } from "./room-store";
import { LiveRoomOutputs } from "./room-outputs";
import { LiveRoomPreview } from "./room-preview";
import { LiveRoomPresence } from "./room-presence";
import { LiveRoomAddedCredits } from "./room-added-credits";
import { refreshLiveCreditCopies } from "./room-credit-refresh";

type Handled = LiveRefusal | void;
const REFUSALS = {
  closed: { code: "LIVE_ROOM_CLOSED", message: "Chat and reactions open shortly before the session starts." },
  questionsClosed: { code: "LIVE_ROOM_CLOSED", message: "This session is no longer taking questions." },
  readOnly: { code: "LIVE_ROOM_READ_ONLY", message: "This connection can only watch the room." },
  operatorOnly: { code: "LIVE_ROOM_OPERATOR_REQUIRED", message: "Only the session's operators can do that." },
  invalid: { code: "LIVE_ROOM_INVALID_MESSAGE", message: "The room could not read that request." },
} satisfies Record<string, LiveRefusal>;

/** Who the room names when it clears something on a person's erasure rather than an operator's action. */
const ERASURE = { userId: "", name: "Privacy erasure" };

/**
 * Session questions, polls, chat and controls use hibernating sockets with
 * participant attachments. The alarm owns durable D1 copies and room erasure.
 */
export class LiveSessionRoom extends DurableObject<Env> implements LiveSessionRoomRpc {
  private readonly databaseSession: LiveRoomDatabaseSession;
  private readonly sessionEnv: Env;
  private readonly access: LiveRoomAccessLease;
  private readonly program: LiveRoomProgram;
  private readonly sql: LiveRoomSql;
  private readonly store: LiveRoomStore;
  private readonly pollStore: LivePollStore;
  private readonly controls: LiveRoomControls;
  private readonly timers: LiveRoomTimers;
  private readonly chat: LiveRoomChat;
  private readonly chatFeed: LiveChatFeed;
  private readonly authors: LiveRoomAuthors;
  private readonly chatActions: LiveRoomChatActions;
  private readonly questions: LiveRoomQuestions;
  private readonly preparedQuestions: LiveRoomPreparedQuestions;
  private readonly answers: LiveRoomAnswers;
  private readonly answerStore: LiveRoomAnswerStore;
  private readonly questionCommands: LiveRoomQuestionCommands;
  private readonly decisions: LiveRoomModerationStore;
  private readonly participation: LiveRoomParticipation;
  private readonly polls: LiveRoomPolls;
  private readonly broadcast: LiveRoomBroadcast;
  private readonly graphics: LiveRoomGraphics;
  private readonly outputs: LiveRoomOutputs;
  private readonly presence: LiveRoomPresence;
  private readonly addedCredits: LiveRoomAddedCredits;
  private readonly desk: LiveDesk;
  private readonly engagement: LiveRoomEngagement;
  private readonly onScreenLists: LiveRoomOnScreenLists;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = new LiveRoomSql(ctx.storage.sql);
    this.store = new LiveRoomStore(this.sql);
    this.databaseSession = new LiveRoomDatabaseSession(env.DB, this.store);
    this.sessionEnv = { ...env, DB: this.databaseSession };
    this.program = new LiveRoomProgram(ctx, this.sessionEnv, (bookmark) => this.databaseSession.seedBookmark(bookmark));
    this.pollStore = new LivePollStore(this.sql);
    const preparedStore = new LivePreparedQuestionStore(this.sql);
    this.chat = new LiveRoomChat(this.sql);
    this.decisions = new LiveRoomModerationStore(this.sql);
    this.access = new LiveRoomAccessLease(
      ctx,
      this.sessionEnv,
      this.sql,
      () => this.store.session(),
      () => [
        ...this.chat.authors(),
        ...this.store.questions().map((row) => row.author_user_id),
        ...this.answerStore.authors(),
      ],
      (userId) => this.forgetParticipant(userId),
      (checked, blocked, readAt) => this.participation.eventBlocksRead(checked, blocked, readAt),
    );
    this.authors = new LiveRoomAuthors(this.sql, new LiveRoomPeople(this.sql), this.sessionEnv, () => {
      const room = this.store.session();
      return room ? { eventId: room.eventId, occurrenceId: room.session.occurrenceId } : null;
    });
    this.chatFeed = new LiveChatFeed(
      this.chat,
      new LiveChatModerationStore(this.sql),
      new LiveChatReactionStore(this.sql),
      this.authors,
      this.decisions,
    );
    this.outputs = new LiveRoomOutputs(this.store, this.pollStore);
    this.controls = new LiveRoomControls(this.store, this.pollStore, this.outputs);
    this.timers = new LiveRoomTimers(this.store, this.outputs);
    this.polls = new LiveRoomPolls(this.store, this.pollStore, this.controls);
    this.broadcast = new LiveRoomBroadcast(
      ctx,
      this.store,
      this.pollStore,
      preparedStore,
      this.chatFeed,
      this.sessionEnv.DB,
      (sockets) => this.access.authorize(sockets),
      () => this.graphics.layouts,
      () => this.graphics.tickerContext,
      (work) => this.access.run(work),
    );
    this.onScreenLists = new LiveRoomOnScreenLists(ctx, this.store, this.chat, this.broadcast);
    this.graphics = new LiveRoomGraphics(
      this.sessionEnv,
      this.store,
      this.broadcast,
      this.controls,
      this.outputs,
      new LiveRoomPreview(this.store, this.pollStore, this.controls),
      new LiveRoomGraphicBasis(this.sql),
      this.onScreenLists,
    );
    this.graphics.chatTicker = () => liveChatTickerLines(this.chat);
    this.chatActions = new LiveRoomChatActions(
      ctx,
      this.chat,
      this.chatFeed,
      this.store,
      this.broadcast,
      this.authors,
      {
        tickerChanged: () => this.graphics.refreshLocal(),
        listed: () => this.graphics.lists.due(),
        audited: () => this.scheduleCopy(),
        counted: () => this.scheduleCopy(),
      },
    );
    this.questions = new LiveRoomQuestions(this.store, this.broadcast, this.controls, this.authors, this.decisions, {
      allowed: (userId) => this.store.takeQuestionWriteAllowance(userId, nowIso()),
      changed: () => this.scheduleCopy(),
      listed: () => this.graphics.lists.due(),
    });
    this.preparedQuestions = new LiveRoomPreparedQuestions(this.store, preparedStore, this.broadcast, {
      releaseDue: (at) => this.scheduleAlarm(at, true),
      listed: () => this.graphics.lists.due(),
      changed: () => this.scheduleCopy(),
    });
    this.answerStore = new LiveRoomAnswerStore(this.sql);
    this.answers = new LiveRoomAnswers(
      ctx,
      this.store,
      this.answerStore,
      this.broadcast,
      this.authors,
      this.sessionEnv.DB,
      this.decisions,
      () => this.scheduleCopy(),
    );
    this.questionCommands = new LiveRoomQuestionCommands(this.questions, this.answers, this.broadcast);
    this.participation = new LiveRoomParticipation(
      ctx,
      this.sessionEnv.DB,
      this.store,
      this.chat,
      this.chatActions,
      this.questions,
      this.answers,
      this.answerStore,
      this.decisions,
      this.authors.people,
      this.broadcast,
    );
    this.presence = new LiveRoomPresence(ctx, (sockets) => this.access.eligible(sockets));
    this.addedCredits = new LiveRoomAddedCredits(this.sessionEnv.DB, this.store);
    this.engagement = new LiveRoomEngagement(ctx, this.store, this.polls, this.broadcast, () => this.scheduleCopy());
    this.desk = {
      questions: this.questions,
      preparedQuestions: this.preparedQuestions,
      polls: this.polls,
      controls: this.controls,
      graphics: this.graphics,
      outputs: this.outputs,
      addedCredits: this.addedCredits,
      timers: this.timers,
      broadcast: this.broadcast,
    };
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** The studio loaded another session in this physical room, `next`, or none. */
  async endProgramSources(roomId: string, next: string | null): Promise<void> {
    closeLiveRoomProgramSources(this.ctx, roomId);
    for (const message of this.controls.programLeft(next)) await this.broadcast.all(message);
  }

  /** The studio loaded this session in its physical room. */
  async enterProgram(): Promise<void> {
    for (const message of this.controls.programEntered()) await this.broadcast.all(message);
  }

  async programStage(): Promise<LiveStage> {
    return this.store.stage();
  }

  /** Takes over the Program of the session made active after another in this physical room. */
  async adoptProgramStage(stage: LiveStage): Promise<void> {
    const before = this.store.stage();
    await this.broadcast.all(this.controls.adoptProgram(stage));
    const room = this.store.session();
    if (!room) return;
    for (const message of this.outputs.followProgram(room.session, before, this.store.stage()))
      await this.broadcast.all(message);
  }

  async readProgram(eventId: string, roomId: string): Promise<LiveProgramSelection> {
    return this.program.read(eventId, roomId);
  }
  async loadedProgram(eventId: string, roomId: string): Promise<string | null> {
    return this.program.loaded(eventId, roomId);
  }
  async selectProgram(
    eventId: string,
    roomId: string,
    input: z.infer<typeof liveProgramSelectSchema>,
    claims: UserSessionTokenClaims,
  ): Promise<LiveProgramSelectResult> {
    return this.program.selectResult(eventId, roomId, input, claims);
  }

  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname === "/program/connect") return this.program.connect(request);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    const admission = liveRoomAdmissionSchema.parse(JSON.parse(request.headers.get(LIVE_ROOM_ADMISSION_HEADER) ?? ""));
    this.databaseSession.seedBookmark(admission.readBookmark ?? admission.participant.sessionClaims?.state);
    this.store.saveSession(admission.eventId, admission.session);
    for (const message of refreshLiveCreditCopies(this.store, admission.session)) await this.broadcast.all(message);
    await this.graphics.initialize();
    await this.scheduleAlarm(
      Math.min(liveRoomPurgeAt(admission.session.endAt), Date.now() + LIVE_TICKER_REFRESH_MS),
      true,
    );
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [admission.participant.role]);
    server.serializeAttachment(admission.participant);
    await this.access.admit(server);
    const refreshAt = this.access.nextRefreshAt();
    if (refreshAt !== null) await this.scheduleAlarm(refreshAt, true);
    const snapshot = await this.broadcast.snapshot(server, admission.session);
    if (snapshot !== null && server.readyState === WebSocket.OPEN) server.send(snapshot);
    if (admission.participant.role === "operator") {
      await this.broadcast.operatorsChanged();
      this.presence.greet(server, admission.participant);
    }
    if (admission.participant.role === "overlay") await this.broadcast.sourcesChanged();
    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": LIVE_ROOM_PROTOCOL },
    });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (this.ctx.getTags(socket).includes(LIVE_PROGRAM_SOCKET_TAG)) {
      if (raw !== "ping") socket.close(liveRoomRefusalCloseCode(403), "LIVE_PROGRAM_READ_ONLY");
      return;
    }
    let viewer = socket.deserializeAttachment() as LiveRoomParticipant;
    const message = parseLiveRoomMessage(raw);
    const threadRequestId = message?.type === "question.answers.watch" ? crypto.randomUUID() : null;
    if (threadRequestId) {
      viewer = { ...viewer, questionThreadRequestId: threadRequestId };
      socket.serializeAttachment(viewer);
    }
    return this.access.run(() => this.handleSocketCommand(socket, viewer, message, threadRequestId));
  }

  private async handleSocketCommand(
    socket: WebSocket,
    viewer: LiveRoomParticipant,
    message: LiveRoomClientMessage | null,
    threadRequestId: string | null,
  ): Promise<void> {
    if (message && viewer.role !== "overlay") {
      const room = this.store.session();
      if (!room) return;
      const authorized = await this.access.authorize([socket]);
      if (!authorized.length) {
        await this.left(socket);
        return;
      }
      viewer = socket.deserializeAttachment() as LiveRoomParticipant;
    }
    if (
      threadRequestId &&
      (socket.deserializeAttachment() as LiveRoomParticipant).questionThreadRequestId !== threadRequestId
    )
      return;
    let refusal: Handled;
    try {
      refusal = message ? await this.handle(viewer, message, socket) : REFUSALS.invalid;
    } catch (error) {
      if (!(error instanceof AppError) || error.status < 400 || error.status >= 500) throw error;
      refusal = { code: error.code, message: error.message };
    }
    if (refusal && socket.readyState === WebSocket.OPEN)
      socket.send(
        serializeLiveRoomMessage({
          type: "room.refused",
          ...refusal,
          ...(message && "operationId" in message ? { operationId: message.operationId } : {}),
        }),
      );
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string): Promise<void> {
    if (!this.ctx.getTags(socket).includes(LIVE_PROGRAM_SOCKET_TAG)) await this.left(socket);
    closeLiveRoomSocket(socket, code, reason);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    if (!this.ctx.getTags(socket).includes(LIVE_PROGRAM_SOCKET_TAG)) await this.left(socket);
    closeLiveRoomSocket(socket, 1011, "Room error");
  }

  /**
   * The durable copy's single retry owner: failed copies stay pending for the
   * next scheduled alarm without interrupting access refresh. Once everything
   * is copied and the session is long over, the room erases its own storage.
   */
  async alarm(): Promise<void> {
    return runLiveRoomAlarm({
      ctx: this.ctx,
      program: this.program,
      store: this.store,
      db: this.env.DB,
      access: this.access,
      refreshGraphics: () => this.graphics.refresh(),
      preparedQuestions: this.preparedQuestions,
      copyDue: () => this.copyDue(),
      purge: () => this.purge(),
    });
  }

  /**
   * A person's account was anonymized: their questions leave the room, their
   * votes and ballots are withdrawn, and their open connections end. Safe to
   * repeat; the caller retries until it returns.
   */
  async forgetParticipant(userId: string): Promise<void> {
    // A room already erased after its session holds nothing to forget, and must stay empty.
    if (!this.sql.holdsData()) return;
    this.access.forget(userId);
    const at = nowIso();
    const changedThreads = this.answerStore.forget(userId);
    const { removed, recounted } = this.store.forgetQuestions(userId);
    const polls = this.pollStore.forget(userId);
    const room = this.store.session();
    if (room) await this.preparedQuestions.forget(room.session, userId);
    const chat = this.chat.forget(userId);
    this.decisions.forget(userId);
    this.authors.prune();
    for (const questionId of changedThreads) await this.answers.publish(questionId);
    for (const socket of this.ctx.getWebSockets()) {
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
      if (viewer.userId !== userId) continue;
      if (!this.ctx.getTags(socket).includes(LIVE_PROGRAM_SOCKET_TAG)) await this.left(socket);
      try {
        socket.close(1008, "Access ended");
      } catch {
        // Already closed.
      }
    }
    for (const removed of chat)
      await this.broadcast.all({ type: "chat.removed", messageId: removed.id, channel: removed.channel });
    for (const questionId of removed) {
      await this.broadcast.all({ type: "question.removed", questionId });
      for (const message of this.controls.withdraw(ERASURE, "question", questionId, at))
        await this.broadcast.all(message);
    }
    for (const questionId of recounted) await this.broadcast.question(questionId);
    for (const pollId of polls) await this.broadcast.poll(pollId);
    if (removed.length || recounted.length || chat.length) this.graphics.lists.due();
    if (this.store.hasPendingCopy()) await this.scheduleAlarm(this.copyDue(), true);
  }

  /** The attendee chat the room still holds, oldest first, for the event's chat download. */
  async chatArchive(): Promise<LiveChatArchiveRow[]> {
    return this.sql.holdsData() ? this.chat.archive() : [];
  }

  /** Erases both chat channels, keeping the counts; false while the room is still open. */
  async eraseChat(): Promise<boolean> {
    if (!this.sql.holdsData()) return true;
    if (!liveChatErasable(this.store.session())) return false;
    for (const removed of this.chat.eraseAll())
      await this.broadcast.all({ type: "chat.removed", messageId: removed.id, channel: removed.channel });
    this.graphics.lists.due();
    return true;
  }

  private copyDue(): number {
    return Date.now() + LIVE_ROOM_POLICY.durableCopyDelaySeconds * 1000;
  }

  /** Sets the alarm to `at` unless one is already due sooner (or, when not `sooner`, already set at all). */
  private async scheduleAlarm(at: number, sooner: boolean): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || (sooner && current > at)) await this.ctx.storage.setAlarm(at);
  }

  private async scheduleCopy(): Promise<void> {
    await this.scheduleAlarm(this.copyDue(), true);
  }

  /** The session is a week over: erase the room, or all but the chat its event keeps longer. */
  private async purge(): Promise<void> {
    this.engagement.clear();
    this.onScreenLists.stop();
    const erased = await purgeLiveRoom(this.ctx, this.env.DB, this.store.session(), this.sql, this.chat);
    if (erased) this.databaseSession.reset();
  }

  private async left(socket: WebSocket): Promise<void> {
    const viewer = socket.deserializeAttachment() as LiveRoomParticipant | null;
    // A socket the purge closed can report closing after the erase; telling the others must not recreate the room.
    if (!this.sql.holdsData()) return;
    if (viewer?.role === "overlay") return this.broadcast.sourcesChanged(socket);
    if (viewer?.role !== "operator") return;
    this.presence.left(viewer);
    await this.broadcast.operatorsChanged(socket);
  }

  private session(): LiveRoomSession {
    const room = this.store.session();
    if (!room) throw new Error("A live room received a message before any admission");
    return room.session;
  }

  private async handle(viewer: LiveRoomParticipant, message: LiveRoomClientMessage, socket: WebSocket) {
    if (viewer.role === "overlay" || viewer.userId === null || viewer.name === null) return REFUSALS.readOnly;
    const actor = { userId: viewer.userId, name: viewer.name };
    const operator = viewer.role === "operator";
    const session = this.session();
    const opening = this.store.opening();
    const open = operator || liveRoomOpen(Date.now(), session.startAt, session.endAt, opening);
    const asking = operator || liveRoomTakesQuestions(Date.now(), session.endAt, opening);
    if (!operator && liveCommandParticipates(message.type) && this.decisions.restriction(actor.userId, Date.now()))
      return LIVE_PARTICIPATION_REFUSAL;
    switch (message.type) {
      case "chat.send":
      case "chat.react":
      case "chat.report":
        return open ? this.chatActions.handle(viewer, actor, message, socket) : REFUSALS.closed;
      case "chat.delete":
      case "chat.history":
        return this.chatActions.handle(viewer, actor, message, socket);
      case "author.lookup":
        return this.chatActions.lookupAuthor(viewer, actor, message.handle, socket);
      case "chat.moderate":
      case "chat.convert":
        if (!operator) return REFUSALS.operatorOnly;
        return this.chatActions.handle(viewer, actor, message, socket);
      case "moderation.done":
        return this.participation.done(viewer, actor, message.item, message.done);
      case "participation.block":
        return this.participation.block(viewer, actor, message);
      case "participation.lift":
        return this.participation.lift(viewer, actor, message.item);
      case "question.ask":
      case "question.edit":
      case "question.withdraw":
      case "question.moderate":
      case "question.answers.watch":
      case "question.answer":
      case "question.answer.accept":
      case "question.answer.vote":
      case "question.answer.hide":
        return this.questionCommands.handle(viewer, actor, message, socket, asking);
      case "question.vote":
        return asking ? this.questions.vote(actor.userId, message.questionId, message.voted) : REFUSALS.questionsClosed;
      case "reaction.send":
        return open ? this.engagement.react(actor.userId, message.reaction) : REFUSALS.closed;
      case "poll.vote":
        return asking
          ? this.engagement.votePoll(actor.userId, message.pollId, message.answer, socket)
          : REFUSALS.questionsClosed;
      case "presence.update":
        if (!operator) return REFUSALS.operatorOnly;
        this.presence.update(actor, message);
        return;
    }
    if (!operator) return REFUSALS.operatorOnly;
    const program = this.store.stage();
    return this.apply(this.followed(session, program, await operateLiveDesk(this.desk, actor, session, message)));
  }

  /** An operator's change to Program also reaches the screens that follow it, in the same outcome. */
  private followed(session: LiveRoomSession, before: LiveStage, outcome: LiveControlOutcome): LiveControlOutcome {
    if ("code" in outcome) return outcome;
    const messages = this.outputs.followProgram(session, before, this.store.stage());
    return messages.length ? { ...outcome, messages: [...outcome.messages, ...messages] } : outcome;
  }

  private async apply(outcome: LiveControlOutcome): Promise<Handled> {
    if ("code" in outcome) return outcome;
    for (const message of outcome.messages) await this.broadcast.all(message);
    for (const pollId of new Set(outcome.polls ?? [])) await this.broadcast.poll(pollId);
    await this.scheduleCopy();
  }
}
