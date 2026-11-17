import type { LiveRoomClientMessage } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomAnswers } from "./room-answers";
import type { LiveRoomBroadcast } from "./room-broadcast";
import type { LiveRefusal } from "./room-controls";
import { serializeLiveRoomMessage } from "./room-projection";
import type { LiveRoomQuestions } from "./room-questions";

type Actor = { userId: string; name: string };
export type LiveQuestionCommand = Extract<
  LiveRoomClientMessage,
  {
    type:
      | "question.ask"
      | "question.edit"
      | "question.withdraw"
      | "question.moderate"
      | "question.answers.watch"
      | "question.answer"
      | "question.answer.accept"
      | "question.answer.vote"
      | "question.answer.hide";
  }
>;

/**
 * Routes the question and answer commands. A question's row carries its
 * answer count and accepted answer, and its thread follows the question's
 * visibility, so each change re-sends the other side too.
 */
export class LiveRoomQuestionCommands {
  constructor(
    private readonly questions: LiveRoomQuestions,
    private readonly answers: LiveRoomAnswers,
    private readonly broadcast: LiveRoomBroadcast,
  ) {}

  async handle(
    viewer: LiveRoomParticipant,
    actor: Actor,
    message: LiveQuestionCommand,
    socket: WebSocket,
    open: boolean,
  ): Promise<LiveRefusal | void> {
    switch (message.type) {
      case "question.ask": {
        const result = await this.questions.ask(
          viewer,
          actor,
          message.text,
          message.anonymous,
          message.operationId,
          open,
        );
        if (!("questionId" in result)) return result;
        socket.send(
          serializeLiveRoomMessage({
            type: "question.accepted",
            operationId: message.operationId,
            questionId: result.questionId,
          }),
        );
        return;
      }
      case "question.edit":
      case "question.withdraw": {
        const result = await this.questions.changeAuthorQuestion(actor, message, open);
        if (!("questionId" in result)) return result;
        await this.answers.publish(result.questionId);
        socket.send(
          serializeLiveRoomMessage({ type: "question.updated", operationId: message.operationId, ...result }),
        );
        return;
      }
      case "question.moderate": {
        const refusal = await this.questions.moderate(
          viewer,
          actor,
          message.questionId,
          message.status,
          message.expectedRevision,
          message.reason ?? null,
        );
        if (!refusal) await this.answers.publish(message.questionId);
        return refusal;
      }
      case "question.answers.watch":
        return this.answers.watch(socket, message.questionId);
      case "question.answer.vote": {
        const result = await this.answers.vote(viewer, actor, message);
        return "answerId" in result ? undefined : result;
      }
      case "question.answer.hide": {
        const result = await this.answers.hide(viewer, actor, message);
        if (!("answerId" in result)) return result;
        await this.broadcast.question(message.questionId);
        return;
      }
      case "question.answer":
      case "question.answer.accept": {
        const result =
          message.type === "question.answer"
            ? await this.answers.send(viewer, actor, message)
            : await this.answers.accept(viewer, actor, message);
        if (!("answerId" in result)) return result;
        await this.broadcast.question(message.questionId);
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
    }
  }
}
