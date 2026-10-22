import { LiveRoomEngagement } from "./room-engagement";
import { LiveRoomAnswers } from "./room-answers";
import { LiveRoomAnswerStore } from "./room-answer-store";
import { advanceLiveStage } from "./room-stage-next";
import { LiveRoomGraphics } from "./room-graphics";
import { LIVE_TICKER_REFRESH_MS, liveChatTickerLines } from "./room-ticker";
import { LiveRoomProgram, LIVE_PROGRAM_SOCKET_TAG } from "./room-program";
import type {
  LiveProgramSelection,
  LiveProgramSelectResult,
} from "../../../../assets/shared/schemas/live-room-program";
import type { UserSessionTokenClaims } from "../../auth/user-session-token";
import type { z } from "zod";
import type { liveProgramSelectSchema } from "../../../../assets/shared/schemas/live-room-program";
import { LiveRoomChat } from "./room-chat";
import { LiveRoomChatActions } from "./room-chat-actions";
import { LiveChatFeed } from "./room-chat-feed";
import { LiveChatModerationStore } from "./room-chat-moderation";
import { LiveChatReactionStore } from "./room-chat-reactions";
import { LiveRoomPeople } from "./room-people";
import { LiveRoomAuthors } from "./room-authors";
import { LiveRoomQuestions } from "./room-questions";
import { DurableObject } from "cloudflare:workers";
import { LIVE_ROOM_POLICY, liveRoomOpen, liveRoomPurgeAt } from "../../../../assets/shared/live-session-policy";
import {
  LIVE_ROOM_PROTOCOL,
  type LiveRoomClientMessage,
  type LiveRoomSession,
  type LiveStage,
} from "../../../../assets/shared/schemas/live-session-room";
import type { Env, LiveSessionRoomRpc } from "../../types";
import { withLiveRoomSocketCommandRead } from "./room-command-read";
import { authorizeLiveRoomRecipients, closeLiveRoomSocket } from "./room-recipients";
import { liveRoomRefusalCloseCode } from "../../../../assets/shared/schemas/live-session-room";
import { nowIso } from "../../utils/time";
import { LIVE_ROOM_ADMISSION_HEADER, liveRoomAdmissionSchema, type LiveRoomParticipant } from "./room-admission";
import { LiveRoomBroadcast } from "./room-broadcast";
import { LiveRoomControls, type LiveControlOutcome, type LiveRefusal } from "./room-controls";
import { LiveRoomTimers } from "./room-timers";
import { copyLiveRoomToD1 } from "./room-durable-copy";
import { LivePollStore } from "./room-poll-store";
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
type Actor = { userId: string; name: string };

const REFUSALS = {
  closed: { code: "LIVE_ROOM_CLOSED", message: "Questions and reactions open shortly before the session starts." },
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
  private readonly answers: LiveRoomAnswers;
  private readonly answerStore: LiveRoomAnswerStore;
  private readonly polls: LiveRoomPolls;
  private readonly broadcast: LiveRoomBroadcast;
  private readonly graphics: LiveRoomGraphics;
  private readonly outputs: LiveRoomOutputs;
  private readonly presence: LiveRoomPresence;
  private readonly addedCredits: LiveRoomAddedCredits;
  private readonly engagement: LiveRoomEngagement;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = new LiveRoomSql(ctx.storage.sql);
    this.store = new LiveRoomStore(this.sql);
    this.databaseSession = new LiveRoomDatabaseSession(env.DB, this.store);
    this.sessionEnv = { ...env, DB: this.databaseSession };
    this.program = new LiveRoomProgram(ctx, this.sessionEnv, (bookmark) => this.databaseSession.seedBookmark(bookmark));
    this.pollStore = new LivePollStore(this.sql);
    this.chat = new LiveRoomChat(this.sql);
    this.authors = new LiveRoomAuthors(this.sql, new LiveRoomPeople(this.sql), this.sessionEnv, () => {
      const room = this.store.session();
      return room ? { eventId: room.eventId, occurrenceId: room.session.occurrenceId } : null;
    });
    this.chatFeed = new LiveChatFeed(
      this.chat,
      new LiveChatModerationStore(this.sql),
      new LiveChatReactionStore(this.sql),
      this.authors,
    );
    this.outputs = new LiveRoomOutputs(this.store, this.pollStore);
    this.controls = new LiveRoomControls(this.store, this.pollStore, this.outputs);
    this.timers = new LiveRoomTimers(this.store, this.outputs);
    this.polls = new LiveRoomPolls(this.store, this.pollStore, this.controls);
    this.broadcast = new LiveRoomBroadcast(
      ctx,
      this.store,
      this.pollStore,
      this.chatFeed,
      this.sessionEnv.DB,
      (sockets) => authorizeLiveRoomRecipients(this.sessionEnv, this.store.session(), sockets),
      () => this.graphics.layouts,
      () => this.graphics.tickerContext,
    );
    this.graphics = new LiveRoomGraphics(
      this.sessionEnv,
      this.store,
      this.broadcast,
      this.controls,
      this.outputs,
      new LiveRoomPreview(this.store, this.pollStore, this.controls),
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
        tickerChanged: () => this.graphics.refresh(),
        audited: () => this.scheduleCopy(),
      },
    );
    this.questions = new LiveRoomQuestions(this.store, this.broadcast, this.controls, this.authors, {
      allowed: (userId) => this.store.takeQuestionWriteAllowance(userId, nowIso()),
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
      () => this.scheduleCopy(),
    );
    this.presence = new LiveRoomPresence(ctx);
    this.addedCredits = new LiveRoomAddedCredits(this.sessionEnv.DB, this.store);
    this.engagement = new LiveRoomEngagement(ctx, this.store, this.polls, this.broadcast, () => this.scheduleCopy());
    // Keep-alive pings are answered without waking the room.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async programStage(): Promise<LiveStage> {
    return this.store.stage();
  }

  /** Takes over the Program of the session made active after another in this physical room. */
  async adoptProgramStage(stage: LiveStage): Promise<void> {
    await this.broadcast.all(this.controls.adoptProgram(stage));
  }

  async readProgram(eventId: string, roomId: string): Promise<LiveProgramSelection> {
    return this.program.read(eventId, roomId);
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
    await this.graphics.refresh();
    await this.scheduleAlarm(
      Math.min(liveRoomPurgeAt(admission.session.endAt), Date.now() + LIVE_TICKER_REFRESH_MS),
      true,
    );
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [admission.participant.role]);
    server.serializeAttachment(admission.participant);
    const snapshot = await this.broadcast.snapshot(server, admission.session);
    if (snapshot !== null && server.readyState === WebSocket.OPEN) server.send(snapshot);
    if (admission.participant.role === "operator") {
      await this.broadcast.operatorsChanged();
      this.presence.greet(server, admission.participant);
    }
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
    // Presence arrives up to ten times a second; it rides on the socket's recent full access check.
    const ridesOnAccess =
      message?.type === "presence.update" && viewer.role === "operator" && this.presence.recentlyAuthorized(socket);
    const run = () => this.handleSocketCommand(socket, viewer, message, threadRequestId, ridesOnAccess);
    const room = this.store.session();
    if (!message || viewer.role === "overlay" || ridesOnAccess || !room) return run();
    return withLiveRoomSocketCommandRead(
      {
        env: this.sessionEnv,
        ctx: this.ctx,
        room,
        viewer,
        message,
        erasureCandidates: [
          ...this.chat.authors(),
          ...("questionId" in message && message.questionId ? this.answerStore.participants(message.questionId) : []),
        ],
      },
      run,
    );
  }

  private async handleSocketCommand(
    socket: WebSocket,
    viewer: LiveRoomParticipant,
    message: LiveRoomClientMessage | null,
    threadRequestId: string | null,
    ridesOnAccess: boolean,
  ): Promise<void> {
    if (message && viewer.role !== "overlay" && !ridesOnAccess) {
      const room = this.store.session();
      if (!room) return;
      const authorized = await authorizeLiveRoomRecipients(this.sessionEnv, room, [socket]);
      if (!authorized.length) {
        await this.left(socket);
        return;
      }
      viewer = socket.deserializeAttachment() as LiveRoomParticipant;
      this.presence.authorized(socket);
    }
    if (
      threadRequestId &&
      (socket.deserializeAttachment() as LiveRoomParticipant).questionThreadRequestId !== threadRequestId
    )
      return;
    const refusal = message ? await this.handle(viewer, message, socket) : REFUSALS.invalid;
    if (refusal)
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
   * The durable copy's single retry owner: a failed batch throws, and the
   * runtime retries the alarm. Once everything is copied and the session is
   * long over, the room erases its own storage.
   */
  async alarm(): Promise<void> {
    if (await this.program.exists()) return this.program.alarm();
    const pending = this.store.pendingCopy();
    if (pending) {
      await copyLiveRoomToD1(this.env.DB, pending);
      this.store.markCopied(pending);
    }
    const room = this.store.session();
    if (!room) return;
    if (this.store.hasPendingCopy()) return this.ctx.storage.setAlarm(this.copyDue());
    if (
      Date.now() < liveRoomPurgeAt(room.session.endAt) &&
      this.ctx.getWebSockets().some((socket) => socket.readyState === WebSocket.OPEN)
    ) {
      await this.graphics.refresh();
      return this.ctx.storage.setAlarm(
        Math.min(liveRoomPurgeAt(room.session.endAt), Date.now() + LIVE_TICKER_REFRESH_MS),
      );
    }
    const purgeAt = liveRoomPurgeAt(room.session.endAt);
    if (Date.now() < purgeAt) return this.ctx.storage.setAlarm(purgeAt);
    await this.purge();
  }

  /**
   * A person's account was anonymized: their questions leave the room, their
   * votes and ballots are withdrawn, and their open connections end. Safe to
   * repeat; the caller retries until it returns.
   */
  async forgetParticipant(userId: string): Promise<void> {
    // A room already erased after its session holds nothing to forget, and must stay empty.
    if (!this.sql.holdsData()) return;
    const at = nowIso();
    const changedThreads = this.answerStore.forget(userId);
    const { removed, recounted } = this.store.forgetQuestions(userId);
    const polls = this.pollStore.forget(userId);
    const chat = this.chat.forget(userId);
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
    if (removed.length || recounted.length || polls.length) await this.scheduleAlarm(this.copyDue(), true);
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

  private async purge(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.close(1001, "This session's room has closed");
      } catch {
        // Already closed.
      }
    }
    this.engagement.clear();
    await this.ctx.storage.deleteAll();
    this.sql.erased();
    this.databaseSession.reset();
  }

  private async left(socket: WebSocket): Promise<void> {
    const viewer = socket.deserializeAttachment() as LiveRoomParticipant | null;
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
    const open = operator || liveRoomOpen(Date.now(), session.startAt, session.endAt);
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
      case "chat.restrict":
      case "chat.convert":
        if (!operator) return REFUSALS.operatorOnly;
        return this.chatActions.handle(viewer, actor, message, socket);
      case "question.edit":
      case "question.withdraw": {
        const result = await this.questions.changeAuthorQuestion(actor, message, open);
        if ("questionId" in result) {
          await this.answers.publish(result.questionId);
          socket.send(
            serializeLiveRoomMessage({ type: "question.updated", operationId: message.operationId, ...result }),
          );
          return;
        }
        return result;
      }
      case "question.answers.watch":
        return this.answers.watch(socket, message.questionId);
      case "question.answer":
      case "question.answer.accept": {
        const result =
          message.type === "question.answer"
            ? await this.answers.send(viewer, actor, message)
            : await this.answers.accept(viewer, actor, message);
        if ("answerId" in result) {
          socket.send(
            serializeLiveRoomMessage({
              type: "question.answer.result",
              operationId: message.operationId,
              questionId: message.questionId,
              answerId: result.answerId,
            }),
          );
          return;
        }
        return result;
      }
      case "question.ask": {
        const result = await this.questions.ask(
          viewer,
          actor,
          message.text,
          message.anonymous,
          message.operationId,
          open,
        );
        if ("questionId" in result) {
          socket.send(
            serializeLiveRoomMessage({
              type: "question.accepted",
              operationId: message.operationId,
              questionId: result.questionId,
            }),
          );
          return;
        }
        return result;
      }
      case "question.vote":
        return open ? this.questions.vote(actor.userId, message.questionId, message.voted) : REFUSALS.closed;
      case "reaction.send":
        return open ? this.engagement.react(actor.userId, message.reaction) : REFUSALS.closed;
      case "poll.vote":
        return open ? this.engagement.votePoll(actor.userId, message.pollId, message.answer, socket) : REFUSALS.closed;
      case "question.moderate": {
        const refusal = await this.questions.moderate(
          viewer,
          actor,
          message.questionId,
          message.status,
          message.expectedRevision,
        );
        if (!refusal) await this.answers.publish(message.questionId);
        return refusal;
      }
      case "presence.update":
        if (!operator) return REFUSALS.operatorOnly;
        this.presence.update(actor, message);
        return;
    }
    if (!operator) return REFUSALS.operatorOnly;
    return this.apply(await this.operate(actor, session, message));
  }

  /** The control desk's actions, each one a single synchronous change of the room's storage. */
  private async operate(
    actor: Actor,
    session: LiveRoomSession,
    message: Exclude<
      LiveRoomClientMessage,
      {
        type:
          | "question.ask"
          | "question.edit"
          | "question.withdraw"
          | "question.answers.watch"
          | "question.answer"
          | "question.answer.accept"
          | "question.vote"
          | "reaction.send"
          | "poll.vote"
          | "question.moderate"
          | `chat.${string}`
          | "author.lookup"
          | "presence.update";
      }
    >,
  ): Promise<LiveControlOutcome> {
    await this.graphics.refresh();
    const at = nowIso();
    switch (message.type) {
      case "question.rewrite":
        return this.questions.rewrite(actor, message.questionId, message.text, at);
      case "poll.save":
        return this.polls.save(actor, message.pollId, message.draft, at, message.discardRemovedAnswers ?? false);
      case "poll.delete":
        return this.polls.remove(actor, message.pollId, at);
      case "poll.status":
        return this.polls.setStatus(actor, message.pollId, message.status, at);
      case "stage.question":
        return this.controls.putQuestionOnStage(actor, message.questionId, at);
      case "stage.lowerThird":
        return this.controls.showLowerThird(actor, session, message.creditKey, at, message.motion);
      case "stage.panelists":
        return this.controls.setPanelists(actor, message.panelists, at);
      case "stage.schedule":
        return this.graphics.setSchedule(actor, message.schedule, at);
      case "stage.ticker":
        return this.graphics.setTicker(actor, message.ticker, at);
      case "stage.set":
        return this.graphics.setStage(actor, session, message, at);
      case "aux.set":
        return this.graphics.setAux(actor, session, message, at);
      case "preview.set":
        return this.graphics.setPreview(actor, session, message, at);
      case "preview.take":
        return this.graphics.takePreview(actor, session, at);
      case "speaker.message":
        return this.outputs.setSpeakerMessage(actor, message.text, message.tone, message.flash, at);
      case "program.clear":
        return this.controls.clearProgram(actor, at);
      case "program.restore":
        return this.controls.restoreProgram(actor, message.snapshotId, at);
      case "credit.add":
        return this.addedCredits.add(actor, message.person, at);
      case "credit.remove":
        return this.addedCredits.remove(actor, message.creditKey, at);
      case "stage.poll":
        return this.controls.showPoll(actor, message.pollId, at);
      case "stage.next":
        return advanceLiveStage(this.controls, this.polls, this.broadcast, actor, session, message.view, at);
      case "queue.add":
        return this.controls.enqueue(actor, session, message.view, message.itemId, at);
      case "queue.remove":
        return this.controls.dequeue(actor, message.view, message.itemId, at);
      case "queue.move":
        return this.controls.move(actor, message.view, message.itemId, message.direction, at);
      case "overlay.mode":
        return this.controls.overlayMode(actor, message.mode, at);
      case "timer.add":
        return this.timers.add(actor, session, message.timer, Date.now(), at);
      case "timer.remove":
        return this.timers.remove(actor, session, message.timerId, at);
      case "timer.adjust":
        return this.timers.adjust(actor, session, message.timerId, message.deltaSeconds, Date.now(), at);
      case "stage.timer":
        return this.controls.setTimer(actor, session, message.timer, message.visible, at);
      case "timer.control":
        return this.timers.control(actor, session, message.timerId, message.action, Date.now(), at);
    }
  }

  private async apply(outcome: LiveControlOutcome): Promise<Handled> {
    if ("code" in outcome) return outcome;
    for (const message of outcome.messages) await this.broadcast.all(message);
    for (const pollId of new Set(outcome.polls ?? [])) await this.broadcast.poll(pollId);
    await this.scheduleCopy();
  }
}
