import { AppError } from "../../errors";
import { LiveRoomEngagement } from "./room-engagement";
import { LiveRoomAnswers } from "./room-answers";
import { LiveRoomAnswerStore } from "./room-answer-store";
import { LiveRoomModerationStore } from "./room-moderation-store";
import { LiveRoomParticipation } from "./room-participation";
import { LIVE_PARTICIPATION_REFUSAL, liveCommandParticipates } from "./room-participation-refusal";
import { LiveOccurrenceChatAccess } from "./room-occurrence-chat-access";
import type { LiveEventBlockDecision, LiveOccurrenceModerationChange } from "./room-occurrence-participation";
import { connectLiveOccurrence } from "./room-connection";
import { LiveRoomQuestionCommands } from "./room-question-commands";
import { operateLiveDesk, type LiveDesk } from "./room-desk";
import { LiveRoomGraphics } from "./room-graphics";
import { LiveRoomGraphicBasis } from "./room-graphic-basis";
import { LiveRoomOnScreenLists } from "./room-on-screen-lists";
import { liveChatTickerLines } from "./room-ticker";
import { LiveRoomProgram, LIVE_PROGRAM_SOCKET_TAG, closeLiveRoomProgramSources } from "./room-program";
import type {
  LiveProgramSelection,
  LiveProgramSelect,
  LiveProgramSelectResult,
} from "../../../../assets/shared/schemas/live-room-program";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import { LiveRoomChat, type LiveChatArchiveRow } from "./room-chat";
import { liveChatErasable, purgeLiveRoom } from "./room-purge";
import { LiveRoomClassifiers } from "./room-classifiers";
import { LiveRoomChatActions } from "./room-chat-actions";
import { LiveChatFeed } from "./room-chat-feed";
import { LiveChatModerationStore } from "./room-chat-moderation";
import { LiveChatReactionStore } from "./room-chat-reactions";
import { LiveRoomPeople } from "./room-people";
import { LiveRoomAuthors } from "./room-authors";
import { LiveRoomQuestions } from "./room-questions";
import { DurableObject } from "cloudflare:workers";
import { LIVE_ROOM_POLICY } from "../../../../assets/shared/live-session-policy";
import {
  liveRoomRefusalCloseCode,
  type LiveRoomClientMessage,
  type LiveRoomSession,
  type LiveStage,
} from "../../../../assets/shared/schemas/live-session-room";
import type { Env, LiveSessionRoomRpc } from "../../types";
import { LiveRoomAccessLease } from "./room-access-lease";
import { runLiveRoomAlarm } from "./room-alarm";
import { closeLiveRoomSocket } from "./room-socket-close";
import { nowIso } from "../../utils/time";
import type { LiveRoomParticipant } from "./room-admission";
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
import { LiveLocationChatStore } from "./location-chat-store";
import { LiveLocationChatRoom } from "./location-chat-room";
import { LiveSessionCommands } from "./room-session-commands";
import { liveRoomChatScope } from "./room-chat-scope";
import { liveLocationOnAirChat, type LiveChatOnAirOptions, type LiveChatQuestion } from "./location-chat-on-air";

type Handled = LiveRefusal | void;
const REFUSALS = {
  readOnly: { code: "LIVE_ROOM_READ_ONLY", message: "This connection can only watch the room." },
  invalid: { code: "LIVE_ROOM_INVALID_MESSAGE", message: "The room could not read that request." },
} satisfies Record<string, LiveRefusal>;

const copyDue = (): number => Date.now() + LIVE_ROOM_POLICY.durableCopyDelaySeconds * 1000;

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
  private readonly location: LiveLocationChatStore;
  private readonly locationChat: LiveLocationChatRoom;
  private readonly occurrenceParticipation: LiveOccurrenceChatAccess;
  private readonly sessionCommands: LiveSessionCommands;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = new LiveRoomSql(ctx.storage.sql);
    this.store = new LiveRoomStore(this.sql);
    this.location = new LiveLocationChatStore(this.sql);
    this.databaseSession = new LiveRoomDatabaseSession(env.DB, this.store);
    this.sessionEnv = { ...env, DB: this.databaseSession };
    this.program = new LiveRoomProgram(ctx, this.sessionEnv, (bookmark) => this.databaseSession.seedBookmark(bookmark));
    this.pollStore = new LivePollStore(this.sql);
    const preparedStore = new LivePreparedQuestionStore(this.sql);
    this.chat = new LiveRoomChat(this.sql);
    const classifiers = new LiveRoomClassifiers(this.sessionEnv, this.store, this.location);
    this.decisions = new LiveRoomModerationStore(this.sql);
    this.access = new LiveRoomAccessLease(
      ctx,
      this.sessionEnv,
      this.sql,
      () => this.store.session() ?? this.location.accessScope(),
      () => [
        ...this.chat.authors(),
        ...this.store.questions().map((row) => row.author_user_id),
        ...this.answerStore.authors(),
      ],
      (userId) => this.forgetParticipant(userId),
      (checked, blocked, readAt) => this.participation.eventBlocksRead(checked, blocked, readAt),
    );
    this.authors = new LiveRoomAuthors(this.sql, new LiveRoomPeople(this.sql), this.sessionEnv, () =>
      liveRoomChatScope(this.store, this.location),
    );
    this.chatFeed = new LiveChatFeed(
      this.chat,
      new LiveChatModerationStore(this.sql),
      new LiveChatReactionStore(this.sql),
      this.authors,
      this.decisions,
      (occurrenceId, userIds) =>
        this.locationChat.occurrenceModeration(occurrenceId ?? this.location.stamp(Date.now()))?.restrictions(userIds),
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
    // A session shows its location's chat on air; it holds no chat of its own.
    const onAirChat = liveLocationOnAirChat(
      this.sessionEnv,
      () => this.store.session(),
      () => this.decisions.blockedUserIds(nowIso()),
    );
    this.onScreenLists = new LiveRoomOnScreenLists(ctx, this.store, onAirChat, this.broadcast);
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
    this.graphics.chatTicker = () => liveChatTickerLines(onAirChat);
    this.chatActions = new LiveRoomChatActions(
      ctx,
      this.chat,
      this.chatFeed,
      this.store,
      this.broadcast,
      this.authors,
      classifiers,
      {
        onAirChanged: () => this.locationChat.onAirChanged(),
        stamp: () => this.location.stamp(Date.now()),
        checkWrite: (viewer, occurrenceId) => this.locationChat.checkWrite(viewer, occurrenceId),
        ask: (question, by, at) => this.locationChat.ask(question, by, at),
        audited: () => this.scheduleCopy(),
        counted: () => this.scheduleCopy(),
        participationChanged: (userId) => this.participation.changed(userId),
      },
    );
    this.questions = new LiveRoomQuestions(this.store, this.broadcast, this.controls, this.authors, this.decisions, {
      checked: (text) => classifiers.run("question", text),
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
      () => liveRoomChatScope(this.store, this.location)?.eventId ?? null,
      (occurrenceId) => this.locationChat.occurrenceModeration(occurrenceId),
      () => this.location.stamp(Date.now()),
      (userId, decision) => this.occurrenceParticipation.notify(userId, decision),
    );
    this.occurrenceParticipation = new LiveOccurrenceChatAccess(
      ctx,
      env,
      this.sql,
      this.store,
      this.decisions,
      (userId, decision) => this.participation.changed(userId, undefined, undefined, decision),
      (at) => this.scheduleAlarm(at, true),
    );
    this.locationChat = new LiveLocationChatRoom({
      ctx,
      env: this.sessionEnv,
      store: this.location,
      chat: this.chat,
      access: this.access,
      broadcast: this.broadcast,
      feed: this.chatFeed,
      chatActions: this.chatActions,
      participation: this.participation,
      staff: this.store,
      seedBookmark: (bookmark) => this.databaseSession.seedBookmark(bookmark),
      purge: () => this.purge(),
    });
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
    this.sessionCommands = new LiveSessionCommands(
      this.store,
      this.chatActions,
      this.participation,
      this.questionCommands,
      this.questions,
      this.engagement,
      this.presence,
      async (actor, session, message) => {
        const program = this.store.stage();
        return this.apply(this.followed(session, program, await operateLiveDesk(this.desk, actor, session, message)));
      },
    );
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  /** The studio loaded another session in this physical room, `next`, or none. */
  async endProgramSources(roomId: string, next: string | null): Promise<void> {
    closeLiveRoomProgramSources(this.ctx, roomId);
    for (const message of this.controls.programLeft(next)) await this.broadcast.all(message);
  }

  async enterProgram(): Promise<void> {
    for (const message of this.controls.programEntered()) await this.broadcast.all(message);
  }

  async programStage(): Promise<LiveStage> {
    return this.store.stage();
  }

  async adoptProgramStage(stage: LiveStage): Promise<void> {
    const before = this.store.stage();
    await this.broadcast.all(this.controls.adoptProgram(stage));
    const room = this.store.session();
    if (!room) return;
    for (const message of this.outputs.followProgram(room.session, before, this.store.stage()))
      await this.broadcast.all(message);
  }

  async scenesChanged(): Promise<void> {
    if (this.store.session()) await this.graphics.refreshAfterChange();
  }

  async locationChatLoaded(occurrenceId: string | null): Promise<void> {
    this.locationChat.loaded(occurrenceId);
  }

  async readOccurrenceParticipation(userId: string) {
    return this.occurrenceParticipation.read(userId);
  }

  async readOccurrenceRestrictions(userIds: string[]) {
    return this.occurrenceParticipation.restrictions(userIds);
  }

  async changeOccurrenceModeration(userId: string, endsAt: string, change: LiveOccurrenceModerationChange) {
    return this.occurrenceParticipation.change(userId, endsAt, change);
  }

  async locationChatAccessChanged(occurrenceId: string, userId: string | null, decision?: LiveEventBlockDecision) {
    return this.locationChat.accessChanged(occurrenceId, userId, decision);
  }

  async locationChatOnAir(occurrenceId: string, limit: number, options: LiveChatOnAirOptions) {
    return this.locationChat.onAir(occurrenceId, limit, options);
  }

  async locationChatFirstSentAfter(occurrenceId: string, since: string) {
    return this.location.state() ? this.chat.firstSentAfter(occurrenceId, since) : null;
  }

  async locationChatChanged(): Promise<void> {
    if (!this.store.session()) return;
    this.graphics.lists.due();
    await this.graphics.refreshLocal();
  }

  async questionFromChat(question: LiveChatQuestion, by: { userId: string; name: string }, at: string) {
    return this.store.session() ? this.questions.fromChat(question, by, at) : null;
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
    input: LiveProgramSelect,
    claims: UserSessionTokenClaims,
  ): Promise<LiveProgramSelectResult> {
    return this.program.selectResult(eventId, roomId, input, claims);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/program/connect") return this.program.connect(request);
    if (path === "/chat/connect") return this.locationChat.connect(request);
    return connectLiveOccurrence(request, {
      ctx: this.ctx,
      store: this.store,
      access: this.access,
      broadcast: this.broadcast,
      graphics: this.graphics,
      presence: this.presence,
      databaseSession: this.databaseSession,
      scheduleAlarm: (at) => this.scheduleAlarm(at, true),
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
      if (!this.store.session() && !this.location.state()) return;
      const authorized = await this.access.authorize([socket]);
      if (!authorized.length) return this.left(socket);
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

  async alarm(): Promise<void> {
    if (!this.store.session()) {
      if (this.location.state()) return this.locationChat.alarm();
      if (await this.occurrenceParticipation.resumePurge(() => this.purge())) return;
    }
    return runLiveRoomAlarm({
      ctx: this.ctx,
      program: this.program,
      store: this.store,
      db: this.env.DB,
      access: this.access,
      refreshGraphics: () => this.graphics.refresh(),
      preparedQuestions: this.preparedQuestions,
      copyDue,
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
    for (const removed of chat) await this.broadcast.chatRemoved(removed);
    for (const questionId of removed) {
      await this.broadcast.all({ type: "question.removed", questionId });
      for (const message of this.controls.withdraw(ERASURE, "question", questionId, at))
        await this.broadcast.all(message);
    }
    for (const questionId of recounted) await this.broadcast.question(questionId);
    for (const pollId of polls) await this.broadcast.poll(pollId);
    if (removed.length || recounted.length || chat.length) this.graphics.lists.due();
    if (this.store.hasPendingCopy() || this.location.pendingCopy()) await this.scheduleAlarm(copyDue(), true);
  }

  /** The attendee chat the room still holds, oldest first, for the event's chat download; anonymized people's posts leave it first. */
  async chatArchive(): Promise<LiveChatArchiveRow[]> {
    if (!this.sql.holdsData()) return [];
    for (const removed of await this.chat.eraseAnonymizedAuthors(this.env.DB))
      await this.broadcast.chatRemoved(removed);
    return this.chat.archive();
  }

  /** Erases both chat channels, keeping the counts; false while the room is still open. */
  async eraseChat(): Promise<boolean> {
    if (!this.sql.holdsData()) return true;
    if (!liveChatErasable(liveRoomChatScope(this.store, this.location))) return false;
    for (const removed of this.chat.eraseAll()) await this.broadcast.chatRemoved(removed);
    this.graphics.lists.due();
    return true;
  }

  /** Sets the alarm to `at` unless one is already due sooner (or, when not `sooner`, already set at all). */
  private async scheduleAlarm(at: number, sooner: boolean): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || (sooner && current > at)) await this.ctx.storage.setAlarm(at);
  }

  private async scheduleCopy(): Promise<void> {
    await this.scheduleAlarm(copyDue(), true);
  }

  /** The session is a week over: erase the room, or all but the chat its event keeps longer. */
  private async purge(): Promise<void> {
    this.engagement.clear();
    this.onScreenLists.stop();
    const scope = liveRoomChatScope(this.store, this.location);
    // A chat kept past its session still drops the posts of anyone anonymized since.
    if (this.sql.holdsData()) await this.chat.eraseAnonymizedAuthors(this.env.DB);
    const erased = await purgeLiveRoom(this.ctx, this.env.DB, scope, this.sql, this.chat);
    if (!erased) return;
    this.databaseSession.reset();
    this.location.erased();
  }

  private async left(socket: WebSocket): Promise<void> {
    const viewer = socket.deserializeAttachment() as LiveRoomParticipant | null;
    // A socket the purge closed can report closing after the erase; telling the others must not recreate the room.
    if (!this.sql.holdsData() || !this.store.session()) return;
    if (viewer?.role === "overlay") return this.broadcast.sourcesChanged(socket);
    if (!viewer) return;
    this.presence.left(viewer, socket);
    if (viewer.role === "operator") await this.broadcast.operatorsChanged(socket);
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
    if (!operator && liveCommandParticipates(message.type) && this.decisions.restriction(actor.userId, Date.now()))
      return LIVE_PARTICIPATION_REFUSAL;
    if (!this.store.session()) return this.locationChat.handle(viewer, actor, message, socket);
    return this.sessionCommands.handle(viewer, actor, this.session(), message, socket);
  }

  /** An operator's change to Program also reaches the screens that follow it, in the same outcome. */
  private followed(session: LiveRoomSession, before: LiveStage, outcome: LiveControlOutcome): LiveControlOutcome {
    if ("code" in outcome) return outcome;
    const messages = this.outputs.followProgram(session, before, this.store.stage());
    return messages.length ? { ...outcome, messages: [...outcome.messages, ...messages] } : outcome;
  }

  private async apply(outcome: LiveControlOutcome): Promise<Handled> {
    if ("code" in outcome) return outcome;
    for (const message of outcome.messages) {
      await this.broadcast.all(message);
      if (message.type === "room.opening.changed") this.occurrenceParticipation.notify(null);
    }
    for (const pollId of new Set(outcome.polls ?? [])) await this.broadcast.poll(pollId);
    await this.scheduleCopy();
  }
}
