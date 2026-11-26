import {
  canSetLiveParticipationBlock,
  type LiveModerationReason,
  type LiveParticipationBlock,
  type LiveParticipationRestriction,
} from "../../../../assets/shared/live-moderation-policy";
import { LIVE_CHAT_POLICY } from "../../../../assets/shared/live-chat-policy";
import type { LiveModerationItem } from "../../../../assets/shared/schemas/live-session-moderation";
import type { DatabaseLike } from "../../types";
import { nowIso } from "../../utils/time";
import { blockEventParticipation, liftEventParticipationBlock } from "./event-participation-blocks";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomAnswers } from "./room-answers";
import type { LiveRoomAnswerStore } from "./room-answer-store";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveRoomChat } from "./room-chat";
import type { LiveRoomChatActions } from "./room-chat-actions";
import type { LiveRefusal } from "./room-controls";
import type { LiveRoomModerationStore } from "./room-moderation-store";
import type { LiveRoomPeople } from "./room-people";
import { serializeLiveRoomMessage } from "./room-projection";
import type { LiveRoomQuestions } from "./room-questions";
import type { LiveRoomStore } from "./room-store";
import type { LiveOccurrenceModeration } from "./room-occurrence-participation";

const REFUSALS = {
  missing: { code: "LIVE_MODERATION_NOT_FOUND", message: "This post is no longer available." },
  forbidden: { code: "LIVE_MODERATION_FORBIDDEN", message: "You can't do that in this session." },
  staff: { code: "LIVE_MODERATION_STAFF", message: "People who run this session can't be blocked." },
  notDone: {
    code: "LIVE_MODERATION_DONE_UNSUPPORTED",
    message: "Only questions and chat messages can be marked done.",
  },
} satisfies Record<string, LiveRefusal>;

type Actor = { userId: string; name: string };

/** The signed-in session an organizer acts by, which D1 checks again; null for a socket without one. */
function organizerSession(viewer: LiveRoomParticipant, actor: Actor): { userId: string; sessionId: string } | null {
  const claims = viewer.sessionClaims;
  return claims && claims.sub === actor.userId ? { userId: actor.userId, sessionId: claims.sid } : null;
}

/**
 * Moderation that reaches a person rather than one post: the studio's Done
 * flag, and pausing, blocking and lifting a block on whoever wrote a chat
 * message, question or answer. Pauses and session blocks stay in the room;
 * an event block is written to D1 first and then mirrored here.
 */
export class LiveRoomParticipation {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly db: DatabaseLike,
    private readonly store: LiveRoomStore,
    private readonly chat: LiveRoomChat,
    private readonly chatActions: LiveRoomChatActions,
    private readonly questions: LiveRoomQuestions,
    private readonly answers: LiveRoomAnswers,
    private readonly answerStore: LiveRoomAnswerStore,
    private readonly decisions: LiveRoomModerationStore,
    private readonly people: LiveRoomPeople,
    private readonly broadcast: LiveRoomBroadcast,
    /** The event the room's people act in, whether it holds a session or a location's chat. */
    private readonly eventId: () => string | null,
    private readonly chatModeration: (occurrenceId: string | null) => LiveOccurrenceModeration | null,
    private readonly currentChatOccurrence: () => string | null,
    /** Tells the occurrence's location chats; an event decision made here goes along. */
    private readonly occurrenceChanged: (userId: string, eventBlocked?: boolean) => void,
  ) {}

  /** Who wrote the item, or null when it is gone. */
  private author(item: LiveModerationItem): string | null {
    if (item.kind === "chat") return this.chat.message(item.messageId)?.author_user_id ?? null;
    if (item.kind === "question") return this.store.question(item.questionId)?.author_user_id ?? null;
    const answer = this.answerStore.answer(item.answerId);
    return answer && answer.question_id === item.questionId ? answer.author_user_id : null;
  }

  private chatOccurrence(item: LiveModerationItem): string | undefined {
    if (item.kind !== "chat") return undefined;
    return this.chat.message(item.messageId)?.occurrence_id ?? this.currentChatOccurrence() ?? undefined;
  }

  private moderationFor(item: LiveModerationItem) {
    const occurrence = this.chatOccurrence(item);
    return occurrence ? this.chatModeration(occurrence) : null;
  }

  async done(viewer: LiveRoomParticipant, actor: Actor, item: LiveModerationItem, done: boolean) {
    if (viewer.role !== "operator") return REFUSALS.forbidden;
    if (item.kind === "answer") return REFUSALS.notDone;
    const at = nowIso();
    if (item.kind === "chat") {
      const row = this.chat.message(item.messageId);
      if (!row) return REFUSALS.missing;
      this.decisions.setDone("chat", row.id, done, actor.name, at);
      await this.chatActions.redeliver([row]);
      return;
    }
    if (!this.store.question(item.questionId)) return REFUSALS.missing;
    this.decisions.setDone("question", item.questionId, done, actor.name, at);
    await this.broadcast.question(item.questionId);
  }

  async block(
    viewer: LiveRoomParticipant,
    actor: Actor,
    input: {
      item: LiveModerationItem;
      block: LiveParticipationBlock;
      reason: LiveModerationReason;
      removePosts: boolean;
    },
  ): Promise<LiveRefusal | void> {
    if (!canSetLiveParticipationBlock({ role: viewer.role, organizer: viewer.organizer }, input.block))
      return REFUSALS.forbidden;
    const userId = this.author(input.item);
    if (!userId) return REFUSALS.missing;
    if (userId === actor.userId || this.people.people([userId]).get(userId)?.staff) return REFUSALS.staff;
    const at = nowIso();
    const eventId = this.eventId();
    let sessionRestriction: LiveParticipationRestriction | undefined;
    const moderation = input.block === "event" ? null : this.moderationFor(input.item);
    // A session's decision covers that session's posts; an event or location decision covers the whole chat.
    const scope = moderation ? this.chatOccurrence(input.item) : undefined;
    if (input.block === "event") {
      if (!eventId) return REFUSALS.missing;
      const by = organizerSession(viewer, actor);
      if (!by || !(await blockEventParticipation(this.db, { eventId, userId, reason: input.reason, by, at })))
        return REFUSALS.forbidden;
      this.decisions.decideEventBlock(userId, true);
      await this.shareEventDecision(userId, true, input.item);
    } else {
      if (moderation) {
        const { restriction } = await moderation.change(userId, {
          kind: "block",
          block: input.block,
          reason: input.reason,
          actor,
          at,
        });
        if (!restriction) return REFUSALS.forbidden;
        sessionRestriction = restriction;
      } else {
        if (input.item.kind === "chat" && input.block === "session") return REFUSALS.forbidden;
        this.decisions.block(userId, input.block, input.reason, actor, at);
      }
    }
    this.store.recordStaffAction(
      actor.userId,
      "live_session.participation.blocked",
      { userId, block: input.block, reason: input.reason, removePosts: input.removePosts },
      at,
    );
    if (input.removePosts) await this.removePosts(viewer, actor, userId, input.reason, at, input.item, scope);
    await this.changed(userId, sessionRestriction, scope);
  }

  async lift(viewer: LiveRoomParticipant, actor: Actor, item: LiveModerationItem): Promise<LiveRefusal | void> {
    if (viewer.role !== "operator") return REFUSALS.forbidden;
    const userId = this.author(item);
    if (!userId) return REFUSALS.missing;
    const local = this.decisions.restriction(userId, Date.now());
    const occurrenceId = this.chatOccurrence(item);
    const moderation = this.moderationFor(item);
    const remote = local?.block === "event" ? null : (await moderation?.read(userId))?.restriction;
    const current = remote ?? local;
    if (!current) return;
    if (!canSetLiveParticipationBlock({ role: viewer.role, organizer: viewer.organizer }, current.block))
      return REFUSALS.forbidden;
    const at = nowIso();
    const eventId = this.eventId();
    if (current.block === "event") {
      if (!eventId) return REFUSALS.missing;
      const by = organizerSession(viewer, actor);
      if (!by || !(await liftEventParticipationBlock(this.db, { eventId, userId, by, at }))) return REFUSALS.forbidden;
      this.decisions.decideEventBlock(userId, false);
      await this.shareEventDecision(userId, false, item);
    }
    let sessionRestriction: LiveParticipationRestriction | null | undefined;
    const sessionLift = moderation !== null && current.block !== "event" && remote;
    if (sessionLift) {
      sessionRestriction = (await moderation.change(userId, { kind: "lift" })).restriction;
    } else {
      this.decisions.lift(userId);
    }
    this.store.recordStaffAction(
      actor.userId,
      "live_session.participation.lifted",
      { userId, block: current.block },
      at,
    );
    await this.changed(userId, sessionRestriction, sessionLift ? occurrenceId : undefined);
  }

  /**
   * An event block this room just wrote to D1 reaches the rooms the person is in now, so none of them keeps
   * refusing (or allowing) them until its own next read of D1: the location chat's sessions, or the session's
   * location chats.
   */
  private async shareEventDecision(userId: string, blocked: boolean, item: LiveModerationItem): Promise<void> {
    this.occurrenceChanged(userId, blocked);
    const occurrences = new Set([this.chatOccurrence(item), this.currentChatOccurrence()]);
    await Promise.all(
      [...occurrences].map((id) => (id ? this.chatModeration(id)?.change(userId, { kind: "event", blocked }) : null)),
    );
  }

  /** The access refresh read who is blocked for the event; tell everyone whose block started or ended. */
  async eventBlocksRead(checked: readonly string[], blocked: ReadonlySet<string>, readAt: number): Promise<void> {
    for (const userId of this.decisions.refreshEventBlocks(checked, blocked, readAt)) await this.changed(userId);
  }

  /** Removes everything the person posted in the block's scope, and the reported post, with the block's reason. */
  private async removePosts(
    viewer: LiveRoomParticipant,
    actor: Actor,
    userId: string,
    reason: LiveModerationReason,
    at: string,
    item: LiveModerationItem,
    occurrenceId?: string,
  ): Promise<void> {
    const messages = this.chat.byAuthor(userId, LIVE_CHAT_POLICY.storedMessages, occurrenceId);
    const reported = item.kind === "chat" ? this.chat.message(item.messageId) : null;
    if (reported?.author_user_id === userId && !messages.some((row) => row.id === reported.id)) messages.push(reported);
    const shown = messages.filter((row) => !this.decisions.removal(row.id));
    for (const row of shown) this.chatActions.removeWithReason(actor, row, reason, at);
    await this.chatActions.redeliver(shown);
    for (const question of this.store.questions())
      if (question.author_user_id === userId && question.status !== "hidden")
        await this.questions.moderate(viewer, actor, question.id, "hidden", question.author_revision, reason);
    const threads = new Set<string>();
    for (const answer of this.answers.byAuthor(userId)) {
      if (this.decisions.removal(answer.id)) continue;
      await this.answers.removeWithReason(answer.id, reason, actor, at);
      threads.add(answer.question_id);
    }
    for (const questionId of threads) {
      await this.broadcast.question(questionId);
      await this.answers.publish(questionId);
    }
  }

  /**
   * A person's restriction changed: they learn their own, and moderators see
   * it on every post of theirs still in the room.
   */
  async changed(
    userId: string,
    restriction = this.decisions.restriction(userId, Date.now()),
    occurrenceId?: string,
  ): Promise<void> {
    this.occurrenceChanged(userId);
    const message = serializeLiveRoomMessage({ type: "participation.access", restriction });
    for (const socket of this.ctx.getWebSockets()) {
      const viewer = socket.deserializeAttachment() as LiveRoomParticipant | null;
      if (viewer?.userId !== userId || viewer.role === "operator") continue;
      if (occurrenceId && restriction?.block !== "event" && occurrenceId !== this.currentChatOccurrence()) continue;
      try {
        socket.send(message);
      } catch {
        /* Already closed. */
      }
    }
    await this.chatActions.redeliver(this.chat.byAuthor(userId, LIVE_CHAT_POLICY.storedMessages, occurrenceId));
    for (const question of this.store.questions())
      if (question.author_user_id === userId) await this.broadcast.question(question.id);
    for (const questionId of new Set(this.answers.byAuthor(userId).map((answer) => answer.question_id)))
      await this.answers.publish(questionId);
  }
}
