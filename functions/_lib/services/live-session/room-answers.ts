import {
  canAcceptLiveQuestionAnswer,
  canAnswerLiveQuestion,
  liveRoomOpen,
  PUBLIC_LIVE_QUESTION_STATUSES,
} from "../../../../assets/shared/live-session-policy";
import type {
  LiveQuestionAnswer,
  liveQuestionAnswerAcceptSchema,
  liveQuestionAnswerHideSchema,
  liveQuestionAnswerSendSchema,
  liveQuestionAnswerVoteSchema,
} from "../../../../assets/shared/schemas/live-session-answer";
import type { LiveRoomServerMessage } from "../../../../assets/shared/schemas/live-session-room";
import type { z } from "zod";
import { deterministicUuid } from "../../utils/ids";
import { nowIso } from "../../utils/time";
import type { DatabaseLike } from "../../types";
import { anonymizedLiveParticipantIds } from "./room-erasure";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomAnswerStore, LiveAnswerRow } from "./room-answer-store";
import { parseLiveAuthorStamp, type LiveRoomAuthors } from "./room-authors";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveRefusal } from "./room-controls";
import type { LiveQuestionRow, LiveRoomStore } from "./room-store";
import type { LiveRoomModerationStore } from "./room-moderation-store";
import type { LiveModerationReason } from "../../../../assets/shared/live-moderation-policy";
import { LIVE_PARTICIPATION_REFUSAL } from "./room-participation-refusal";

const REFUSALS = {
  missing: { code: "LIVE_ANSWER_NOT_FOUND", message: "This question or answer is no longer available." },
  closed: { code: "LIVE_ANSWERS_CLOSED", message: "This question is not taking replies now." },
  full: { code: "LIVE_ANSWERS_FULL", message: "This question is not taking more replies." },
  tooFast: { code: "LIVE_ROOM_RATE_LIMITED", message: "Please wait a moment before replying again." },
  forbidden: {
    code: "LIVE_ANSWER_ACCEPT_FORBIDDEN",
    message: "Only the person who asked, an organizer, or a moderator can accept answers.",
  },
  conflict: {
    code: "LIVE_ANSWER_REQUEST_CONFLICT",
    message: "This request was already used for a different answer or decision.",
  },
  changed: { code: "LIVE_ANSWER_CHANGED", message: "This answer changed. Review the latest answer before deciding." },
  ownVote: { code: "LIVE_ANSWER_OWN_VOTE", message: "You can't upvote your own answer." },
  moderators: { code: "LIVE_ANSWER_MODERATORS_ONLY", message: "Only a moderator can hide an answer." },
  blocked: LIVE_PARTICIPATION_REFUSAL,
} satisfies Record<string, LiveRefusal>;

type Actor = { userId: string; name: string };
type Result = LiveRefusal | { answerId: string };

/** One authorized, bounded answer thread per socket, independent of media and public broadcast output. */
export class LiveRoomAnswers {
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly questions: LiveRoomStore,
    private readonly store: LiveRoomAnswerStore,
    private readonly broadcast: LiveRoomBroadcast,
    private readonly authors: LiveRoomAuthors,
    private readonly db: DatabaseLike,
    private readonly decisions: LiveRoomModerationStore,
    private readonly changed: () => Promise<void>,
  ) {}

  /** A removed answer reaches only its author and moderators. */
  private shows(answer: LiveAnswerRow, viewer: LiveRoomParticipant, removed: boolean): boolean {
    return !removed || viewer.role === "operator" || answer.author_user_id === viewer.userId;
  }

  private restricted(viewer: LiveRoomParticipant): boolean {
    return viewer.role !== "operator" && this.decisions.restriction(viewer.userId, Date.now()) !== null;
  }

  private visible(question: LiveQuestionRow | null, viewer: LiveRoomParticipant): question is LiveQuestionRow {
    return (
      question !== null &&
      viewer.role !== "overlay" &&
      (PUBLIC_LIVE_QUESTION_STATUSES.includes(question.status) ||
        viewer.role === "operator" ||
        question.author_user_id === viewer.userId)
    );
  }

  private open(viewer: LiveRoomParticipant): boolean {
    const room = this.questions.session();
    return (
      room !== null &&
      (viewer.role === "operator" || liveRoomOpen(Date.now(), room.session.startAt, room.session.endAt))
    );
  }

  async watch(socket: WebSocket, questionId: string | null): Promise<LiveRefusal | void> {
    const viewer = socket.deserializeAttachment() as LiveRoomParticipant;
    socket.serializeAttachment({ ...viewer, questionThreadId: undefined });
    if (questionId === null) return;
    if (!this.visible(this.questions.question(questionId), viewer)) return REFUSALS.missing;
    socket.serializeAttachment({ ...viewer, questionThreadId: questionId });
    await this.publish(questionId, socket);
  }

  async send(
    viewer: LiveRoomParticipant,
    actor: Actor,
    input: z.infer<typeof liveQuestionAnswerSendSchema>,
  ): Promise<Result> {
    const room = this.questions.session();
    if (!room || !this.visible(this.questions.question(input.questionId), viewer)) return REFUSALS.missing;
    const id = await deterministicUuid([
      room.eventId,
      room.session.occurrenceId,
      "question.answer",
      input.questionId,
      actor.userId,
      input.operationId,
    ]);
    const replay = (): Result | null => {
      const answer = this.store.answer(id);
      if (!answer) return null;
      return answer.question_id === input.questionId &&
        answer.author_user_id === actor.userId &&
        answer.body === input.text
        ? { answerId: id }
        : REFUSALS.conflict;
    };
    const existing = replay();
    if (existing) return existing;
    const stamp = await this.authors.writing(viewer);
    const repeated = replay();
    if (repeated) return repeated;
    const question = this.questions.question(input.questionId);
    if (!this.visible(question, viewer)) return REFUSALS.missing;
    if (this.restricted(viewer)) return REFUSALS.blocked;
    if (!this.open(viewer) || !canAnswerLiveQuestion(viewer.role, question.status)) return REFUSALS.closed;
    const at = nowIso();
    const refusal = this.store.canAdd(input.questionId, actor.userId, at);
    if (refusal) return REFUSALS[refusal];
    this.store.add({
      id,
      question_id: input.questionId,
      author_user_id: actor.userId,
      author_name: actor.name,
      body: input.text,
      author_json: JSON.stringify(stamp),
      created_at: at,
    });
    await this.changed();
    await this.publish(input.questionId);
    return { answerId: id };
  }

  async accept(
    viewer: LiveRoomParticipant,
    actor: Actor,
    input: z.infer<typeof liveQuestionAnswerAcceptSchema>,
  ): Promise<Result> {
    const question = this.questions.question(input.questionId);
    if (!this.visible(question, viewer)) return REFUSALS.missing;
    if (
      !canAcceptLiveQuestionAnswer({
        role: viewer.role,
        organizer: viewer.organizer ?? false,
        mine: question.author_user_id === actor.userId,
      })
    )
      return REFUSALS.forbidden;
    if (question.author_withdrawn) return REFUSALS.closed;
    const answer = this.store.answer(input.answerId);
    if (!answer || answer.question_id !== input.questionId || this.decisions.removal(answer.id))
      return REFUSALS.missing;
    if (answer.last_decision_operation_id === input.operationId && answer.last_decision_actor_id === actor.userId) {
      return answer.last_decision_accepted === Number(input.accepted) &&
        answer.last_decision_basis_revision === input.expectedRevision
        ? { answerId: answer.id }
        : REFUSALS.conflict;
    }
    if (answer.revision !== input.expectedRevision) return REFUSALS.changed;
    const at = nowIso();
    this.store.accept(answer, actor, input.operationId, input.accepted, at);
    if (viewer.role === "operator" || viewer.organizer)
      this.questions.recordStaffAction(
        actor.userId,
        "live_session.answer.acceptance_changed",
        { questionId: question.id, answerId: answer.id, accepted: input.accepted },
        at,
      );
    await this.changed();
    await this.publish(question.id);
    return { answerId: answer.id };
  }

  /** One upvote per person on another person's answer. */
  async vote(
    viewer: LiveRoomParticipant,
    actor: Actor,
    input: z.infer<typeof liveQuestionAnswerVoteSchema>,
  ): Promise<Result> {
    const question = this.questions.question(input.questionId);
    if (!this.visible(question, viewer)) return REFUSALS.missing;
    const answer = this.store.answer(input.answerId);
    if (!answer || answer.question_id !== input.questionId || this.decisions.removal(answer.id))
      return REFUSALS.missing;
    if (answer.author_user_id === actor.userId) return REFUSALS.ownVote;
    if (this.restricted(viewer)) return REFUSALS.blocked;
    if (!this.open(viewer)) return REFUSALS.closed;
    this.store.vote(answer.id, actor.userId, input.voted);
    await this.changed();
    await this.publish(question.id);
    return { answerId: answer.id };
  }

  /** A moderator removes an answer with a reason, or shows it again. */
  async hide(
    viewer: LiveRoomParticipant,
    actor: Actor,
    input: z.infer<typeof liveQuestionAnswerHideSchema>,
  ): Promise<Result> {
    if (viewer.role !== "operator") return REFUSALS.moderators;
    const answer = this.store.answer(input.answerId);
    if (!answer || answer.question_id !== input.questionId) return REFUSALS.missing;
    if (answer.revision !== input.expectedRevision) return REFUSALS.changed;
    const at = nowIso();
    if (input.hidden && input.reason) await this.removeWithReason(answer, input.reason, actor, at);
    else {
      this.decisions.restore(answer.id);
      this.store.changed(answer.id);
      await this.changed();
    }
    this.questions.recordStaffAction(
      actor.userId,
      input.hidden ? "live_session.answer.removed" : "live_session.answer.restored",
      { questionId: answer.question_id, answerId: answer.id, ...(input.hidden ? { reason: input.reason } : {}) },
      at,
    );
    await this.publish(answer.question_id);
    return { answerId: answer.id };
  }

  /** Removes an answer from everyone but its author and moderators; a removed answer is no longer accepted. */
  async removeWithReason(answer: LiveAnswerRow, reason: LiveModerationReason, actor: Actor, at: string): Promise<void> {
    this.decisions.remove("answer", answer.id, reason, actor, at);
    if (answer.accepted_at) this.store.accept(answer, actor, crypto.randomUUID(), false, at);
    this.store.changed(answer.id);
    await this.changed();
  }

  /** Every answer one person wrote in this room. */
  byAuthor(userId: string): LiveAnswerRow[] {
    return this.store.byAuthor(userId);
  }

  async publish(questionId: string, only?: WebSocket): Promise<void> {
    const sockets = only
      ? [only]
      : this.ctx
          .getWebSockets()
          .filter((socket) => (socket.deserializeAttachment() as LiveRoomParticipant).questionThreadId === questionId);
    if (!sockets.length) return;
    // Reply-only participants have no D1 question copy to discover during account erasure.
    // Apply the canonical anonymization guard before any thread history leaves the room.
    for (const userId of await anonymizedLiveParticipantIds(this.db, this.store.participants(questionId)))
      this.store.forget(userId);
    let question: LiveQuestionRow | null | undefined;
    let answers: LiveAnswerRow[] | undefined;
    let removals: ReturnType<LiveRoomModerationStore["removals"]> | undefined;
    let staffInfo:
      | {
          restrictions: ReturnType<LiveRoomModerationStore["restrictions"]>;
          people: ReturnType<LiveRoomAuthors["people"]["people"]>;
        }
      | undefined;
    await this.broadcast.send(
      (viewer): LiveRoomServerMessage | null => {
        if (viewer.questionThreadId !== questionId || viewer.role === "overlay") return null;
        if (question === undefined) question = this.questions.question(questionId);
        if (!this.visible(question, viewer))
          return {
            type: "question.answers",
            questionId,
            answers: [],
            canAnswer: false,
            canAccept: false,
            canVote: false,
            canModerate: false,
          };
        const visibleQuestion = question;
        answers ??= this.store.answers(questionId);
        removals ??= this.decisions.removals(answers.map((answer) => answer.id));
        const operator = viewer.role === "operator";
        if (operator && !staffInfo) {
          const authorIds = answers.map((answer) => answer.author_user_id);
          staffInfo = {
            restrictions: this.decisions.restrictions(authorIds, Date.now()),
            people: this.authors.people.people(authorIds),
          };
        }
        const voted = this.store.votedBy(
          viewer.userId,
          answers.map((answer) => answer.id),
        );
        const canAccept =
          !question.author_withdrawn &&
          canAcceptLiveQuestionAnswer({
            role: viewer.role,
            organizer: viewer.organizer ?? false,
            mine: question.author_user_id === viewer.userId,
          });
        return {
          type: "question.answers",
          questionId,
          answers: answers.flatMap((answer): LiveQuestionAnswer[] => {
            const removal = removals?.get(answer.id) ?? null;
            if (!this.shows(answer, viewer, removal !== null)) return [];
            const stamp = parseLiveAuthorStamp(answer.author_json);
            const anonymousAcceptor =
              visibleQuestion.anonymous === 1 &&
              answer.accepted_by_user_id === visibleQuestion.author_user_id &&
              viewer.userId !== visibleQuestion.author_user_id &&
              viewer.role !== "operator";
            return [
              {
                id: answer.id,
                text: answer.body,
                authorName: answer.author_name,
                authorAffiliation: stamp.affiliation,
                authorRoles: stamp.roles,
                mine: answer.author_user_id === viewer.userId,
                createdAt: answer.created_at,
                revision: answer.revision,
                acceptance: answer.accepted_at
                  ? {
                      byName: anonymousAcceptor ? null : (answer.accepted_by_name ?? "Former participant"),
                      at: answer.accepted_at,
                    }
                  : null,
                votes: answer.votes,
                votedByMe: voted.has(answer.id),
                removal: removal
                  ? { reason: removal.reason, at: removal.at, byName: operator ? removal.by_name : null }
                  : null,
                authorRestriction: operator ? (staffInfo?.restrictions.get(answer.author_user_id) ?? null) : null,
                authorStaff: operator ? (staffInfo?.people.get(answer.author_user_id)?.staff ?? false) : false,
              },
            ];
          }),
          canAnswer: this.open(viewer) && canAnswerLiveQuestion(viewer.role, question.status),
          canAccept,
          canVote: viewer.userId !== null && this.open(viewer),
          canModerate: operator,
        };
      },
      null,
      sockets,
    );
  }
}
