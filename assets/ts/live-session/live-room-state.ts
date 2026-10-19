import type { liveQuestionAnswersSchema } from "../../shared/schemas/live-session-answer";
import type { z } from "zod";
import { applyLiveChatMessage } from "./live-chat-state";
import type { LiveAuthorDetails } from "../../shared/schemas/live-session-author";
import { compareLiveQuestions, type LiveQuestionOrder, type LiveReactionId } from "../../shared/live-session-policy";
import { compareLivePolls, type LivePoll } from "../../shared/schemas/live-session-poll";
import type { LiveQuestion, LiveRoomServerMessage, LiveRoomSnapshot } from "../../shared/schemas/live-session-room";

/** What a browser knows about a room: the last snapshot with every pushed change applied. */
export interface LiveRoomState extends Omit<LiveRoomSnapshot, "type"> {
  /** Only the question the viewer currently expanded; replaced after each reconnect. */
  thread?: z.infer<typeof liveQuestionAnswersSchema> | null;
  /** The latest reaction burst, numbered so a view can replay it once. */
  burst: { sequence: number; counts: Partial<Record<LiveReactionId, number>> } | null;
  /** The latest clear of Program this desk can undo. */
  programUndo?: { snapshotId: string; change: { operatorName: string; at: string } } | null;
  /** The latest refused action, numbered so a view can announce it once. */
  refusal: { sequence: number; code: string; message: string } | null;
  /** Author cards the room answered, by handle; null when a handle resolved to no one. */
  authors?: Readonly<Record<string, LiveAuthorDetails | null>>;
}

/** Everyone the room offers as a lower third: the session's credits, then the people operators added. */
export function liveRoomCredits(state: Pick<LiveRoomState, "session" | "addedCredits">) {
  return [...state.session.credits, ...state.addedCredits];
}

/** The room's questions in one of the shared orders; the room itself pushes them in `top` order. */
export function orderLiveQuestions(questions: readonly LiveQuestion[], order: LiveQuestionOrder): LiveQuestion[] {
  return [...questions].sort((left, right) => compareLiveQuestions(order, left, right));
}

/** The poll an attendee is asked about now: the open one, else the latest closed one with results to show. */
export function currentLivePoll(polls: readonly LivePoll[]): LivePoll | null {
  return (
    polls.find((poll) => poll.status === "open") ??
    [...polls].reverse().find((poll) => poll.status === "closed" && poll.results !== null) ??
    null
  );
}

/** Applies one room message. Changes before the first snapshot are ignored; the snapshot carries them. */
export function applyLiveRoomMessage(
  state: LiveRoomState | null,
  message: LiveRoomServerMessage,
): LiveRoomState | null {
  if (message.type === "room.snapshot") {
    const { type: _type, ...snapshot } = message;
    return { ...snapshot, thread: null, burst: null, refusal: null };
  }
  if (!state) return null;
  switch (message.type) {
    case "question.answers":
      return { ...state, thread: message };
    case "question.answer.result":
    case "question.accepted":
    case "question.updated":
      return state;
    case "question.changed":
      return {
        ...state,
        questions: orderLiveQuestions(
          [...state.questions.filter((question) => question.id !== message.question.id), message.question],
          "top",
        ),
      };
    case "question.removed":
      return { ...state, questions: state.questions.filter((question) => question.id !== message.questionId) };
    case "poll.changed":
      return {
        ...state,
        polls: [...state.polls.filter((poll) => poll.id !== message.poll.id), message.poll].sort(compareLivePolls),
      };
    case "poll.removed":
      return { ...state, polls: state.polls.filter((poll) => poll.id !== message.pollId) };
    case "stage.changed":
      return { ...state, stage: message.stage };
    case "aux.changed":
      return { ...state, outputs: { ...state.outputs, [message.output]: message.composition } };
    case "speaker.message.changed":
      return { ...state, speakerMessage: message.speakerMessage };
    case "preview.changed":
      // Only operators receive Preview; its question is the stage display's next one.
      return { ...state, preview: message.composition, stageDisplayNext: message.composition.question };
    case "presence.changed":
    case "presence.left":
      // Presence is ephemeral and changes many times a second; the control room keeps it outside the room state.
      return state;
    case "queue.changed":
      return { ...state, queue: message.queue };
    case "operators.changed":
      return { ...state, operators: message.operators };
    case "stage.display.next.changed":
      return { ...state, stageDisplayNext: message.question };
    case "program.cleared":
      return { ...state, programUndo: { snapshotId: message.snapshotId, change: message.change } };
    case "credits.added.changed":
      return { ...state, addedCredits: message.addedCredits };
    case "chat.message":
    case "chat.removed":
    case "chat.reactions":
    case "chat.history":
    case "chat.access":
      return applyLiveChatMessage(state, message);
    case "overlay.mode.changed":
      return { ...state, overlayMode: message.mode };
    case "overlay.layouts.changed":
      return { ...state, overlayLayouts: message.layouts };
    case "ticker.context.changed":
      return { ...state, tickerContext: message.context };
    case "timers.changed":
      return { ...state, timers: message.timers };
    case "reaction.burst": {
      const totals = { ...state.reactionTotals };
      for (const [reaction, count] of Object.entries(message.counts) as Array<[LiveReactionId, number]>)
        totals[reaction] = (totals[reaction] ?? 0) + count;
      return {
        ...state,
        reactionTotals: totals,
        burst: { sequence: (state.burst?.sequence ?? 0) + 1, counts: message.counts },
      };
    }
    case "author.details":
      return { ...state, authors: { ...state.authors, [message.handle]: message.author } };
    case "room.refused":
      return {
        ...state,
        refusal: { sequence: (state.refusal?.sequence ?? 0) + 1, code: message.code, message: message.message },
      };
  }
}
