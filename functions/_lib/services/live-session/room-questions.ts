import {
  LIVE_ROOM_POLICY,
  canEditOwnLiveQuestion,
  liveQuestionTransitionAllowed,
  type LiveQuestionStatus,
} from "../../../../assets/shared/live-session-policy";
import type { LiveRoomClientMessage, LiveRoomServerMessage } from "../../../../assets/shared/schemas/live-session-room";
import { deterministicUuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomAuthors } from "./room-authors";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveControlOutcome, LiveRefusal, LiveRoomControls } from "./room-controls";
import type { LiveRoomStore } from "./room-store";

type Handled = LiveRefusal | void;
type Actor = { userId: string; name: string };

export const LIVE_QUESTION_REFUSALS = {
  operatorOnly: { code: "LIVE_ROOM_OPERATOR_REQUIRED", message: "Only the session's operators can do that." },
  tooFast: { code: "LIVE_ROOM_RATE_LIMITED", message: "Please wait a moment before trying again." },
  full: { code: "LIVE_ROOM_FULL", message: "This session is not taking more questions." },
  conflict: {
    code: "LIVE_QUESTION_REQUEST_CONFLICT",
    message: "This question request was already used for different content.",
  },
  changed: { code: "LIVE_QUESTION_CHANGED", message: "This question changed. Review it before trying again." },
  withdrawn: { code: "LIVE_QUESTION_WITHDRAWN", message: "This question was withdrawn and cannot be brought back." },
  notEditable: {
    code: "LIVE_QUESTION_EDIT_CLOSED",
    message: "You can edit a question before a moderator reviews it. You can still withdraw it.",
  },
  ownerOnly: {
    code: "LIVE_QUESTION_AUTHOR_REQUIRED",
    message: "Only the person who asked can change or withdraw this question.",
  },
  closed: { code: "LIVE_ROOM_CLOSED", message: "This session is not taking questions now." },
  missing: { code: "LIVE_QUESTION_NOT_FOUND", message: "That question is no longer available." },
  transition: { code: "LIVE_QUESTION_TRANSITION", message: "That question cannot move to this status." },
} satisfies Record<string, LiveRefusal>;
const REFUSALS = LIVE_QUESTION_REFUSALS;

/**
 * The room's question use cases: ask, vote, moderate and rewrite. Each
 * changes the room's storage synchronously, audits staff decisions, and
 * tells every viewer what they may now see.
 */
export class LiveRoomQuestions {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly controls: LiveRoomControls,
    private readonly authors: LiveRoomAuthors,
    private readonly hooks: {
      /** Takes one of the person's questions from their sliding allowance, or refuses. */
      allowed: (userId: string) => boolean;
      /** The durable copy is due. */
      changed: () => Promise<void>;
    },
  ) {}

  /** The existing question row is the bounded durable receipt for this actor's request. */
  async ask(
    viewer: LiveRoomParticipant,
    actor: Actor,
    text: string,
    anonymous: boolean,
    operationId: string,
    open: boolean,
  ): Promise<LiveRefusal | { questionId: string }> {
    const room = this.store.session();
    if (!room) throw new Error("LIVE_ROOM_SESSION_REQUIRED");
    const id = await deterministicUuid([
      room.eventId,
      room.session.occurrenceId,
      "question.ask",
      actor.userId,
      operationId,
    ]);
    const replay = () => {
      const question = this.store.question(id);
      if (!question) return null;
      return question.author_user_id === actor.userId &&
        question.submitted_body === text &&
        Boolean(question.anonymous) === anonymous
        ? { questionId: id }
        : REFUSALS.conflict;
    };
    const existing = replay();
    if (existing) return existing;
    if (!open) return REFUSALS.closed;
    const stamp = await this.authors.writing(viewer);
    // Author resolution yields: another invocation may have accepted this request.
    const accepted = replay();
    if (accepted) return accepted;
    if (this.store.questionCount() >= LIVE_ROOM_POLICY.maxQuestionsPerRoom) return REFUSALS.full;
    if (!this.hooks.allowed(actor.userId)) return REFUSALS.tooFast;
    this.store.addQuestion({
      id,
      authorUserId: actor.userId,
      authorName: actor.name,
      anonymous,
      body: text,
      askedAt: nowIso(),
      authorPhotoUrl: viewer.photoUrl ?? null,
    });
    this.authors.recordQuestion(id, stamp);
    await this.broadcast.question(id);
    await this.hooks.changed();
    return { questionId: id };
  }

  async changeAuthorQuestion(
    actor: Actor,
    input: Extract<LiveRoomClientMessage, { type: "question.edit" | "question.withdraw" }>,
    open: boolean,
  ): Promise<LiveRefusal | { questionId: string; revision: number }> {
    const question = this.store.question(input.questionId);
    if (!question) return REFUSALS.missing;
    if (question.author_user_id !== actor.userId) return REFUSALS.ownerOnly;
    const previous = this.store.authorChange(question.id);
    if (previous?.operation_id === input.operationId) {
      return previous.operation_type === input.type &&
        previous.basis_revision === input.expectedRevision &&
        (input.type !== "question.edit" || previous.text === input.text)
        ? { questionId: question.id, revision: previous.revision }
        : REFUSALS.conflict;
    }
    if (question.author_revision !== input.expectedRevision) return REFUSALS.changed;
    if (question.author_withdrawn) return REFUSALS.withdrawn;
    if (input.type === "question.edit") {
      if (!open) return REFUSALS.closed;
      if (
        !canEditOwnLiveQuestion({
          mine: true,
          status: question.status,
          reviewed: question.moderated_at !== null || question.rewrite_text !== null,
          withdrawn: false,
        })
      )
        return REFUSALS.notEditable;
      if (!this.hooks.allowed(actor.userId)) return REFUSALS.tooFast;
    }
    const at = nowIso();
    const revision = question.author_revision + 1;
    this.store.saveAuthorChange({
      question_id: question.id,
      text: input.type === "question.edit" ? input.text : question.body,
      revision,
      withdrawn: input.type === "question.withdraw" ? 1 : 0,
      operation_id: input.operationId,
      operation_type: input.type,
      basis_revision: input.expectedRevision,
      changed_at: at,
    });
    await this.broadcast.question(question.id);
    const withdrawalActor = question.anonymous === 1 ? { ...actor, name: "Anonymous" } : actor;
    if (input.type === "question.withdraw")
      for (const message of this.controls.withdraw(withdrawalActor, "question", question.id, at))
        await this.broadcast.all(message);
    await this.hooks.changed();
    return { questionId: question.id, revision };
  }

  async vote(userId: string, questionId: string, voted: boolean): Promise<Handled> {
    const question = this.store.question(questionId);
    if (!question || question.status !== "approved") return REFUSALS.missing;
    if (this.store.hasVoted(questionId, userId) === voted) return;
    this.store.setVote(questionId, userId, voted);
    await this.broadcast.question(questionId);
    await this.hooks.changed();
  }

  async rewrite(actor: Actor, questionId: string, text: string, at: string): Promise<LiveControlOutcome> {
    const question = this.store.question(questionId);
    if (!question || question.status === "hidden") return REFUSALS.missing;
    this.store.rewrite(questionId, text, actor, at);
    this.store.recordStaffAction(actor.userId, "live_session.question.rewritten", { questionId }, at);
    await this.broadcast.question(questionId);
    return { messages: this.controls.refreshQuestionOnStage(questionId) };
  }

  async moderate(
    viewer: LiveRoomParticipant,
    actor: Actor,
    questionId: string,
    status: LiveQuestionStatus,
    expectedRevision: number,
  ): Promise<Handled> {
    const question = this.store.question(questionId);
    if (!question) return REFUSALS.missing;
    if (question.author_withdrawn) return REFUSALS.withdrawn;
    if (question.author_revision !== expectedRevision) return REFUSALS.changed;
    if (question.status === status) return;
    if (!liveQuestionTransitionAllowed(viewer.role, question.status, status))
      return viewer.role === "attendee" ? REFUSALS.operatorOnly : REFUSALS.transition;
    const at = nowIso();
    this.store.moderate(questionId, status, actor, at);
    this.store.recordStaffAction(
      actor.userId,
      "live_session.question.moderated",
      { questionId, status: { from: question.status, to: status } },
      at,
    );
    await this.broadcast.question(questionId);
    const cleared: LiveRoomServerMessage[] = this.controls.clearHiddenQuestion(actor, questionId, status, at);
    for (const message of cleared) await this.broadcast.all(message);
    await this.hooks.changed();
  }
}
