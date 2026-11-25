import { liveRoomOpen, liveRoomTakesQuestions } from "../../../../assets/shared/live-session-policy";
import type { LiveRoomClientMessage, LiveRoomSession } from "../../../../assets/shared/schemas/live-session-room";
import type { LiveRoomParticipant } from "./room-admission";
import type { LiveRoomChatActions } from "./room-chat-actions";
import type { LiveDeskCommand, LiveRefusal } from "./room-controls";
import type { LiveRoomEngagement } from "./room-engagement";
import type { LiveRoomParticipation } from "./room-participation";
import type { LiveRoomPresence } from "./room-presence";
import type { LiveRoomQuestionCommands } from "./room-question-commands";
import type { LiveRoomQuestions } from "./room-questions";
import type { LiveRoomStore } from "./room-store";

type Actor = { userId: string; name: string };

/**
 * The desk controls a moderator runs beside the studio: polls, prepared questions, rewording a question and
 * the message to the speaker. They change what the room may show, never what is on air.
 */
const MODERATION_CONTROLS = new Set<LiveRoomClientMessage["type"]>([
  "poll.save",
  "poll.delete",
  "poll.status",
  "question.rewrite",
  "question.prepare",
  "question.prepared.delete",
  "question.prepared.release",
  "question.prepared.window",
  "speaker.message",
]);
type Handled = LiveRefusal | void;

const REFUSALS = {
  closed: { code: "LIVE_ROOM_CLOSED", message: "Reactions open shortly before the session starts." },
  questionsClosed: { code: "LIVE_ROOM_CLOSED", message: "This session is no longer taking questions." },
  operatorOnly: { code: "LIVE_ROOM_OPERATOR_REQUIRED", message: "Only the session's operators can do that." },
  studioOnly: { code: "LIVE_ROOM_STUDIO_REQUIRED", message: "Only the studio's operators can do that." },
  chatInLocation: { code: "LIVE_ROOM_INVALID_MESSAGE", message: "Chat takes place in the location's chat." },
} satisfies Record<string, LiveRefusal>;

/**
 * What a session's room takes from its viewers: questions, votes, polls and reactions while the session takes
 * them, and the desk's controls from operators. Chat belongs to the location, on a connection of its own.
 */
export class LiveSessionCommands {
  /** The desk control applying now; the next one waits for it. */
  private desk: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly store: LiveRoomStore,
    private readonly chatActions: LiveRoomChatActions,
    private readonly participation: LiveRoomParticipation,
    private readonly questionCommands: LiveRoomQuestionCommands,
    private readonly questions: LiveRoomQuestions,
    private readonly engagement: LiveRoomEngagement,
    private readonly presence: LiveRoomPresence,
    /** An operator's desk control, applied and broadcast. */
    private readonly operate: (actor: Actor, session: LiveRoomSession, message: LiveDeskCommand) => Promise<Handled>,
  ) {}

  async handle(
    viewer: LiveRoomParticipant,
    actor: Actor,
    session: LiveRoomSession,
    message: LiveRoomClientMessage,
    socket: WebSocket,
  ): Promise<Handled> {
    const operator = viewer.role === "operator";
    const opening = this.store.opening();
    const open = operator || liveRoomOpen(Date.now(), session.startAt, session.endAt, opening);
    const asking = operator || liveRoomTakesQuestions(Date.now(), session.endAt, opening);
    switch (message.type) {
      case "chat.send":
      case "chat.edit":
      case "chat.react":
      case "chat.report":
      case "chat.delete":
      case "chat.history":
      case "chat.moderate":
      case "chat.convert":
      case "chat.pin":
      case "chat.unpin":
        // A session's chat is its location's, on a connection of its own.
        return REFUSALS.chatInLocation;
      case "author.lookup":
        return this.chatActions.lookupAuthor(viewer, actor, message.handle, socket);
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
        return this.questionCommands.handle(
          viewer,
          actor,
          message,
          socket,
          () => operator || liveRoomTakesQuestions(Date.now(), session.endAt, this.store.opening()),
        );
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
    // The rest of the desk changes what is on air and on the room's screens: the studio's, not every moderator's.
    return viewer.studio || (operator && MODERATION_CONTROLS.has(message.type))
      ? this.inTurn(() => this.operate(actor, session, message))
      : REFUSALS.studioOnly;
  }

  /**
   * Desk controls apply one at a time, in the order they arrive. A control may wait on another room object,
   * such as the location's chat for a chat list, and the room takes the next message meanwhile: each control
   * reads the desk as the one before it left it, so a quick switch-off is never undone by a load still filling.
   */
  private inTurn<Result>(control: () => Promise<Result>): Promise<Result> {
    const turn = this.desk.then(control, control);
    this.desk = turn.catch(() => undefined);
    return turn;
  }
}
