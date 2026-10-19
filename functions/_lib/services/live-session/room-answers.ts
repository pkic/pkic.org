import {
  canAcceptLiveQuestionAnswer,
  canAnswerLiveQuestion,
  liveRoomOpen,
  PUBLIC_LIVE_QUESTION_STATUSES,
} from "../../../../assets/shared/live-session-policy";
import type {
  LiveQuestionAnswer,
  liveQuestionAnswerAcceptSchema,
  liveQuestionAnswerSendSchema,
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
    private readonly changed: () => Promise<void>,
  ) {}

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
    if (!answer || answer.question_id !== input.questionId) return REFUSALS.missing;
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
    await this.broadcast.send(
      (viewer): LiveRoomServerMessage | null => {
        if (viewer.questionThreadId !== questionId || viewer.role === "overlay") return null;
        if (question === undefined) question = this.questions.question(questionId);
        if (!this.visible(question, viewer))
          return { type: "question.answers", questionId, answers: [], canAnswer: false, canAccept: false };
        const visibleQuestion = question;
        answers ??= this.store.answers(questionId);
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
          answers: answers.map((answer): LiveQuestionAnswer => {
            const stamp = parseLiveAuthorStamp(answer.author_json);
            const anonymousAcceptor =
              visibleQuestion.anonymous === 1 &&
              answer.accepted_by_user_id === visibleQuestion.author_user_id &&
              viewer.userId !== visibleQuestion.author_user_id &&
              viewer.role !== "operator";
            return {
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
            };
          }),
          canAnswer: this.open(viewer) && canAnswerLiveQuestion(viewer.role, question.status),
          canAccept,
        };
      },
      null,
      sockets,
    );
  }
}
