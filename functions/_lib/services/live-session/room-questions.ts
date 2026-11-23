import { LIVE_PARTICIPATION_REFUSAL } from "./room-participation-refusal";
import type { LiveRoomModerationStore } from "./room-moderation-store";
import type { LiveModerationReason } from "../../../../assets/shared/live-moderation-policy";
import {
  LIVE_ROOM_POLICY,
  canEditOwnLiveQuestion,
  liveQuestionTransitionAllowed,
  type LiveQuestionStatus,
} from "../../../../assets/shared/live-session-policy";
import type {
  LiveRoomClientMessage,
  LiveRoomServerMessage,
  LiveRoomSession,
} from "../../../../assets/shared/schemas/live-session-room";
import { liveQuestionAddressees, sessionLiveCreditUserId } from "../../../../assets/shared/live-room-credits";
import { deterministicUuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomAuthors } from "./room-authors";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveControlOutcome, LiveRefusal, LiveRoomControls } from "./room-controls";
import type { LiveQuestionAddressee } from "./room-question-rows";
import type { LiveRoomStore } from "./room-store";
import type { LiveChatQuestion } from "./location-chat-on-air";
import type { LiveClassifierVerdict } from "../../../../assets/shared/schemas/live-session-moderation";
import type { ClassifierRun } from "../classifiers/model";

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
  reason: { code: "LIVE_QUESTION_REASON_REQUIRED", message: "Choose why you remove this question." },
  addressee: {
    code: "LIVE_QUESTION_ADDRESSEE_NOT_FOUND",
    message: "That person is no longer on this session. Choose someone else, or ask everyone.",
  },
} satisfies Record<string, LiveRefusal>;
const REFUSALS = LIVE_QUESTION_REFUSALS;

/** Whether the author may still change the words of their own question, as it stands now. */
function editableByAuthor(question: NonNullable<ReturnType<LiveRoomStore["question"]>>): boolean {
  return canEditOwnLiveQuestion({
    mine: true,
    status: question.status,
    reviewed: question.moderated_at !== null || question.rewrite_text !== null,
    withdrawn: false,
  });
}

/**
 * The person a question is for: one of the session's speakers or its
 * moderator, read from its current credits, which every viewer holds and
 * names them from. Null asks everyone; a key
 * the session no longer credits is refused.
 */
export function resolveLiveQuestionAddressee(
  session: LiveRoomSession,
  creditKey: string | null,
): LiveQuestionAddressee | null | LiveRefusal {
  if (creditKey === null) return null;
  if (!liveQuestionAddressees(session.credits).some((credit) => credit.key === creditKey)) return REFUSALS.addressee;
  return { creditKey, userId: sessionLiveCreditUserId(creditKey) };
}

/**
 * The room's question use cases: ask, vote, moderate and rewrite. Each
 * changes the room's storage synchronously, audits staff decisions, and
 * tells every viewer what they may now see.
 */
/** A question's check: the flag moderators see, and the whole run kept for tuning; neither when none ran. */
interface QuestionCheck {
  flag: LiveClassifierVerdict | null;
  run: ClassifierRun | null;
}
const NOT_CHECKED: QuestionCheck = { flag: null, run: null };

export class LiveRoomQuestions {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly controls: LiveRoomControls,
    private readonly authors: LiveRoomAuthors,
    private readonly decisions: LiveRoomModerationStore,
    private readonly hooks: {
      /** Runs the classifier of a question's words; null when no check runs. */
      checked: (text: string) => Promise<ClassifierRun | null>;
      /** Takes one of the person's questions from their sliding allowance, or refuses. */
      allowed: (userId: string) => boolean;
      /** The durable copy is due. */
      changed: () => Promise<void>;
      /** A question changed what an audience list on air may hold. */
      listed: () => void;
    },
  ) {}

  /** An operator turned a chat message into a question: asked as its author wrote it, and approved. */
  async fromChat(question: LiveChatQuestion, by: Actor, at: string): Promise<string> {
    const id = crypto.randomUUID();
    this.store.addQuestion({
      id,
      authorUserId: question.authorUserId,
      authorName: question.authorName,
      anonymous: false,
      body: question.body,
      askedAt: question.askedAt,
      authorPhotoUrl: question.authorPhotoUrl,
    });
    this.store.moderate(id, "approved", by, at);
    if (question.stamp) this.authors.recordQuestion(id, question.stamp);
    await this.broadcast.question(id);
    this.hooks.listed();
    await this.hooks.changed();
    return id;
  }

  /** The existing question row is the bounded durable receipt for this actor's request. */
  async ask(
    viewer: LiveRoomParticipant,
    actor: Actor,
    input: { text: string; anonymous: boolean; addressedTo: string | null },
    operationId: string,
    open: () => boolean,
  ): Promise<LiveRefusal | { questionId: string }> {
    const { text, anonymous, addressedTo } = input;
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
        Boolean(question.anonymous) === anonymous &&
        question.addressed_to === addressedTo
        ? { questionId: id }
        : REFUSALS.conflict;
    };
    const existing = replay();
    if (existing) return existing;
    if (!open()) return REFUSALS.closed;
    const addressee = resolveLiveQuestionAddressee(room.session, addressedTo);
    if (addressee && "code" in addressee) return addressee;
    const stamp = await this.authors.writing(viewer);
    // Author resolution yields: another invocation may have accepted this request.
    const accepted = replay();
    if (accepted) return accepted;
    if (viewer.role !== "operator" && this.decisions.restriction(actor.userId, Date.now()))
      return LIVE_PARTICIPATION_REFUSAL;
    if (this.store.questionCount() >= LIVE_ROOM_POLICY.maxQuestionsPerRoom) return REFUSALS.full;
    if (!this.hooks.allowed(actor.userId)) return REFUSALS.tooFast;
    const check = viewer.role === "operator" ? NOT_CHECKED : await this.check(text);
    if ("code" in check) return check;
    // The check yields: another invocation may have accepted this request meanwhile.
    const checked = replay();
    if (checked) return checked;
    if (!open()) return REFUSALS.closed;
    if (this.store.questionCount() >= LIVE_ROOM_POLICY.maxQuestionsPerRoom) return REFUSALS.full;
    this.store.addQuestion({
      id,
      authorUserId: actor.userId,
      authorName: actor.name,
      anonymous,
      body: text,
      askedAt: nowIso(),
      authorPhotoUrl: viewer.photoUrl ?? null,
      addressee,
    });
    if (check.flag) this.store.questionChecks.flag(id, check.flag);
    if (check.run) this.store.questionChecks.record(id, check.run, nowIso());
    this.authors.recordQuestion(id, stamp);
    await this.broadcast.question(id);
    this.hooks.listed();
    await this.hooks.changed();
    return { questionId: id };
  }

  async changeAuthorQuestion(
    actor: Actor,
    input: Extract<LiveRoomClientMessage, { type: "question.edit" | "question.withdraw" }>,
    open: () => boolean,
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
      if (!open()) return REFUSALS.closed;
      if (!editableByAuthor(question)) return REFUSALS.notEditable;
      if (!this.hooks.allowed(actor.userId)) return REFUSALS.tooFast;
    }
    const check = input.type === "question.edit" ? await this.check(input.text) : NOT_CHECKED;
    if ("code" in check) return check;
    if (input.type === "question.edit" && !open()) return REFUSALS.closed;
    if (input.type === "question.edit") {
      // The check yields: a moderator may have approved the question meanwhile.
      const current = this.store.question(question.id);
      if (current?.author_revision !== question.author_revision) return REFUSALS.changed;
      if (!editableByAuthor(current)) return REFUSALS.notEditable;
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
    if (input.type === "question.edit") {
      this.store.questionChecks.flag(question.id, check.flag);
      this.store.questionChecks.record(question.id, check.run, at);
    }
    await this.broadcast.question(question.id);
    this.hooks.listed();
    const withdrawalActor = question.anonymous === 1 ? { ...actor, name: "Anonymous" } : actor;
    if (input.type === "question.withdraw")
      for (const message of this.controls.withdraw(withdrawalActor, "question", question.id, at))
        await this.broadcast.all(message);
    await this.hooks.changed();
    return { questionId: question.id, revision };
  }

  /**
   * The classifier of a question's words before it is taken: a blocked question is refused with what the
   * check's settings tell its author; an advised one is taken and flagged for moderators. Questions wait for a
   * moderator in any case, so a check that cannot run lets the question in unflagged.
   */
  private async check(text: string): Promise<QuestionCheck | LiveRefusal> {
    const run = await this.hooks.checked(text);
    const outcome = run?.verdict.outcome;
    if (outcome === "blocked")
      return {
        code: "LIVE_QUESTION_REFUSED_BY_CHECK",
        message: run!.verdict.flags.find((flag) => flag.blocking)?.message ?? "This question cannot be asked here.",
      };
    const flag = outcome === "advised" ? { outcome, notes: run!.verdict.flags.map((item) => item.message) } : null;
    return { flag, run };
  }

  async vote(userId: string, questionId: string, voted: boolean): Promise<Handled> {
    const question = this.store.question(questionId);
    if (!question || question.status !== "approved") return REFUSALS.missing;
    if (this.store.hasVoted(questionId, userId) === voted) return;
    this.store.setVote(questionId, userId, voted);
    await this.broadcast.question(questionId);
    this.hooks.listed();
    await this.hooks.changed();
  }

  async rewrite(actor: Actor, questionId: string, text: string, at: string): Promise<LiveControlOutcome> {
    const question = this.store.question(questionId);
    if (!question || question.status === "hidden") return REFUSALS.missing;
    this.store.rewrite(questionId, text, actor, at);
    this.store.recordStaffAction(actor.userId, "live_session.question.rewritten", { questionId }, at);
    await this.broadcast.question(questionId);
    this.hooks.listed();
    return { messages: this.controls.refreshQuestionOnStage(questionId) };
  }

  async moderate(
    viewer: LiveRoomParticipant,
    actor: Actor,
    questionId: string,
    status: LiveQuestionStatus,
    expectedRevision: number,
    /** Why a moderator removes it; required when `status` is hidden. */
    reason: LiveModerationReason | null = null,
  ): Promise<Handled> {
    const question = this.store.question(questionId);
    if (!question) return REFUSALS.missing;
    if (question.author_withdrawn) return REFUSALS.withdrawn;
    if (question.author_revision !== expectedRevision) return REFUSALS.changed;
    if (question.status === status) return;
    if (!liveQuestionTransitionAllowed(viewer.role, question.status, status))
      return viewer.role === "attendee" ? REFUSALS.operatorOnly : REFUSALS.transition;
    if (status === "hidden" && !reason) return REFUSALS.reason;
    const at = nowIso();
    this.store.moderate(questionId, status, actor, at);
    // A new decision about a question replaces an earlier Ignore, so it goes where its status puts it.
    this.decisions.setDone("question", questionId, false, actor.name, at);
    if (status === "hidden" && reason) this.decisions.remove("question", questionId, reason, actor, at);
    else this.decisions.restore(questionId);
    this.store.recordStaffAction(
      actor.userId,
      "live_session.question.moderated",
      {
        questionId,
        status: { from: question.status, to: status },
        ...(reason && status === "hidden" ? { reason } : {}),
      },
      at,
    );
    await this.broadcast.question(questionId);
    this.hooks.listed();
    const cleared: LiveRoomServerMessage[] = this.controls.clearHiddenQuestion(actor, questionId, status, at);
    for (const message of cleared) await this.broadcast.all(message);
    await this.hooks.changed();
  }
}
