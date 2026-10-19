import { updateLiveTimerGraphics } from "../../../../assets/shared/live-timer-policy";
import { DEFAULT_LIVE_POLL_PRESENTATION } from "../../../../assets/shared/schemas/live-session-poll";
import { EMPTY_LIVE_STAGE } from "../../../../assets/shared/schemas/live-session-room";
import {
  LIVE_ROOM_POLICY,
  type LiveQuestionStatus,
  type LiveStageView,
} from "../../../../assets/shared/live-session-policy";
import type {
  LiveOverlayMode,
  LiveQueue,
  LiveRoomServerMessage,
  LiveRoomSession,
  LiveStage,
} from "../../../../assets/shared/schemas/live-session-room";
import type { LivePollStore } from "./room-poll-store";
import type { LiveRoomStore } from "./room-store";
import type { LiveRoomOutputs } from "./room-outputs";
import {
  composeLiveStage,
  findLiveRoomCredit,
  LIVE_CREDIT_NOT_FOUND,
  onAirQuestion,
  ON_AIR_QUESTION_STATUSES,
  type LiveRefusal,
  type ResolvedComposition,
} from "./room-composition";

export type { LiveRefusal } from "./room-composition";
type Operator = { userId: string; name: string };
/** What a control changed: the messages every viewer receives, and the polls whose visibility moved. */
export type LiveControlOutcome = { messages: LiveRoomServerMessage[]; polls?: string[] } | LiveRefusal;

const VIEW_NAME: Record<LiveStageView, string> = { question: "question", "lower-third": "lower third", poll: "poll" };

/**
 * The control desk shared by every operator of a room. Each control is one
 * field, last writer wins, and carries the operator and instant of its latest
 * change so parallel operators, remote or onsite, see who moved it.
 */
export class LiveRoomControls {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly polls: LivePollStore,
    private readonly outputs: LiveRoomOutputs,
  ) {}

  putQuestionOnStage(operator: Operator, questionId: string | null, at: string): LiveControlOutcome {
    let question: LiveStage["question"] = null;
    if (questionId) {
      const resolved = onAirQuestion(this.store, questionId);
      if ("code" in resolved) return resolved;
      question = resolved;
    }
    const stage = { ...this.store.stage(), question, questionChange: { operatorName: operator.name, at } };
    this.store.saveStage(stage);
    this.store.recordStaffAction(operator.userId, "live_session.stage.question", { questionId }, at);
    return { messages: [{ type: "stage.changed", stage }] };
  }

  showLowerThird(
    operator: Operator,
    session: LiveRoomSession,
    creditKey: string | null,
    at: string,
    motion?: LiveStage["lowerThirdMotion"],
  ): LiveControlOutcome {
    const credit = creditKey ? findLiveRoomCredit(this.store, session, creditKey) : null;
    if (creditKey && !credit) return LIVE_CREDIT_NOT_FOUND;
    const current = this.store.stage();
    const stage = {
      ...current,
      lowerThird: credit ?? null,
      lowerThirdChange: { operatorName: operator.name, at },
      lowerThirdMotion: motion ?? current.lowerThirdMotion,
    };
    this.store.saveStage(stage);
    this.store.recordStaffAction(operator.userId, "live_session.stage.lower_third", { creditKey }, at);
    return { messages: [{ type: "stage.changed", stage }] };
  }

  /** Puts a poll's results on the broadcast; drafts stay off air until they open. */
  showPoll(operator: Operator, pollId: string | null, at: string): LiveControlOutcome {
    if (pollId) {
      const poll = this.polls.poll(pollId);
      if (!poll || poll.status === "draft")
        return { code: "LIVE_POLL_NOT_OPEN", message: "Open the poll before showing it on air." };
    }
    const current = this.store.stage();
    const stage = {
      ...current,
      poll: pollId ? { id: pollId, presentation: current.poll?.presentation ?? DEFAULT_LIVE_POLL_PRESENTATION } : null,
      pollChange: { operatorName: operator.name, at },
    };
    this.store.saveStage(stage);
    this.store.recordStaffAction(operator.userId, "live_session.stage.poll", { pollId }, at);
    const polls = [current.poll?.id, pollId].filter((id): id is string => Boolean(id));
    return { messages: [{ type: "stage.changed", stage }], polls };
  }

  /** Validate the whole composed shot, timer graphic included, before one durable write and one broadcast. */
  setStage(
    operator: Operator,
    session: LiveRoomSession,
    input: ResolvedComposition,
    at: string,
    take = false,
  ): LiveControlOutcome {
    const stage = composeLiveStage(this.store, this.polls, session, input, { operatorName: operator.name, at });
    if ("code" in stage) return stage;
    const previous = this.store.stage();
    this.store.saveStage(stage);
    this.store.recordStaffAction(
      operator.userId,
      take ? "live_session.preview.take" : "live_session.stage.set",
      input,
      at,
    );
    return {
      messages: [{ type: "stage.changed", stage }],
      polls: [previous.poll?.id, input.pollId].filter((id): id is string => Boolean(id)),
    };
  }

  setPanelists(operator: Operator, panelists: LiveStage["panelists"], at: string): LiveControlOutcome {
    const stage = { ...this.store.stage(), panelists };
    this.store.saveStage(stage);
    this.store.recordStaffAction(operator.userId, "live_session.stage.panelists", { panelists }, at);
    return { messages: [{ type: "stage.changed", stage }] };
  }

  setSchedule(operator: Operator, schedule: LiveStage["schedule"], at: string): LiveControlOutcome {
    const stage = { ...this.store.stage(), schedule };
    this.store.saveStage(stage);
    this.store.recordStaffAction(
      operator.userId,
      "live_session.stage.schedule",
      { config: schedule?.config ?? null },
      at,
    );
    return { messages: [{ type: "stage.changed", stage }] };
  }

  setTicker(operator: Operator, ticker: LiveStage["ticker"], at: string): LiveControlOutcome {
    const stage = { ...this.store.stage(), ticker };
    this.store.saveStage(stage);
    this.store.recordStaffAction(operator.userId, "live_session.stage.ticker", { ticker }, at);
    return { messages: [{ type: "stage.changed", stage }] };
  }

  /** Shows a timer graphic on Program, or takes it off; the timer it names must be one of the room's. */
  setTimer(
    operator: Operator,
    session: LiveRoomSession,
    timer: LiveStage["timerGraphics"][number],
    visible: boolean,
    at: string,
  ): LiveControlOutcome {
    if (!this.store.timers(session).some((entry) => entry.id === timer.timerId))
      return { code: "LIVE_TIMER_NOT_FOUND", message: "That timer is no longer in this room. Choose another one." };
    const current = this.store.stage();
    const timerGraphics = updateLiveTimerGraphics(current.timerGraphics, timer, visible);
    const stage = { ...current, timerGraphics };
    this.store.saveStage(stage);
    this.store.recordStaffAction(operator.userId, "live_session.stage.timer", { timer, visible }, at);
    return { messages: [{ type: "stage.changed", stage }] };
  }

  /**
   * Takes every graphic off Program in one write, at once: on air there is no
   * time to confirm. The room keeps what was there so any operator can undo it.
   */
  clearProgram(operator: Operator, at: string): LiveControlOutcome {
    const previous = this.store.stage();
    const change = { operatorName: operator.name, at };
    const stage: LiveStage = {
      ...EMPTY_LIVE_STAGE,
      questionChange: change,
      lowerThirdChange: change,
      pollChange: change,
    };
    const snapshotId = crypto.randomUUID();
    this.store.saveStage(stage);
    this.store.saveProgramUndo({ id: snapshotId, stage: previous });
    this.store.recordStaffAction(operator.userId, "live_session.program.cleared", { snapshotId }, at);
    return {
      messages: [
        { type: "stage.changed", stage },
        { type: "program.cleared", snapshotId, change },
      ],
      polls: previous.poll ? [previous.poll.id] : [],
    };
  }

  /** Puts back the Program the latest clear took off, once, whoever cleared it. */
  restoreProgram(operator: Operator, snapshotId: string, at: string): LiveControlOutcome {
    const undo = this.store.programUndo();
    if (!undo || undo.id !== snapshotId)
      return { code: "LIVE_PROGRAM_UNDO_GONE", message: "That clear can no longer be undone." };
    const change = { operatorName: operator.name, at };
    const stage: LiveStage = {
      ...undo.stage,
      questionChange: change,
      lowerThirdChange: change,
      pollChange: change,
    };
    this.store.saveStage(stage);
    this.store.saveProgramUndo(null);
    this.store.recordStaffAction(operator.userId, "live_session.program.restored", { snapshotId }, at);
    return { messages: [{ type: "stage.changed", stage }], polls: stage.poll ? [stage.poll.id] : [] };
  }

  /**
   * Takes over the Program another session of this physical room had on
   * air, when an operator makes this session active: the picture stays as it
   * was until someone Takes this session's Preview. Session questions and
   * polls stay behind, as does any timer this room does not keep.
   */
  adoptProgram(stage: LiveStage): LiveRoomServerMessage {
    const room = this.store.session();
    const timers = room ? this.store.timers(room.session) : [];
    this.store.saveStage({
      ...stage,
      question: null,
      questionChange: null,
      poll: null,
      timerGraphics: stage.timerGraphics.filter((graphic) => timers.some((timer) => timer.id === graphic.timerId)),
    });
    return { type: "stage.changed", stage: this.store.stage() };
  }

  overlayMode(operator: Operator, mode: LiveOverlayMode, at: string): LiveControlOutcome {
    this.store.saveOverlayMode(mode);
    this.store.recordStaffAction(operator.userId, "live_session.overlay_mode", { mode }, at);
    return { messages: [{ type: "overlay.mode.changed", mode }] };
  }

  /** A rewritten question already on air, on Program or any other output, shows its new text at once. */
  refreshQuestionOnStage(questionId: string): LiveRoomServerMessage[] {
    const stage = this.store.stage();
    const row = this.store.question(questionId);
    const others = this.outputs.refreshQuestion(questionId);
    if (!row || stage.question?.id !== questionId) return others;
    const next = { ...stage, question: { ...stage.question, text: row.rewrite_text ?? row.body } };
    this.store.saveStage(next);
    return [{ type: "stage.changed", stage: next }, ...others];
  }

  /** A question taken off the public list also leaves the stage and the lineup. */
  clearHiddenQuestion(
    operator: Operator,
    questionId: string,
    status: LiveQuestionStatus,
    at: string,
  ): LiveRoomServerMessage[] {
    if (status !== "hidden") return [];
    return this.withdraw(operator, "question", questionId, at);
  }

  /** Takes an item that no longer exists off every output and out of its lineup. */
  withdraw(operator: Operator, view: "question" | "poll", itemId: string, at: string): LiveRoomServerMessage[] {
    const messages: LiveRoomServerMessage[] = this.outputs.withdraw(operator, view, itemId, at);
    const stage = this.store.stage();
    const change = { operatorName: operator.name, at };
    // Undo must not restore content that was withdrawn, hidden or erased after Program was cleared.
    const undo = this.store.programUndo();
    if (undo && (view === "question" ? undo.stage.question?.id === itemId : undo.stage.poll?.id === itemId))
      this.store.saveProgramUndo({
        ...undo,
        stage:
          view === "question"
            ? { ...undo.stage, question: null, questionChange: change }
            : { ...undo.stage, poll: null, pollChange: change },
      });
    if (view === "question" && stage.question?.id === itemId) {
      const cleared = { ...stage, question: null, questionChange: change };
      this.store.saveStage(cleared);
      messages.push({ type: "stage.changed", stage: cleared });
    }
    if (view === "poll" && stage.poll?.id === itemId) {
      const cleared = { ...stage, poll: null, pollChange: change };
      this.store.saveStage(cleared);
      messages.push({ type: "stage.changed", stage: cleared });
    }
    const queue = this.store.queue();
    if (queue[view].includes(itemId)) {
      const next = { ...queue, [view]: queue[view].filter((id) => id !== itemId), change };
      this.store.saveQueue(next);
      messages.push({ type: "queue.changed", queue: next });
    }
    return messages;
  }

  private queueable(session: LiveRoomSession, view: LiveStageView, itemId: string): LiveRefusal | null {
    if (view === "question") {
      const row = this.store.question(itemId);
      if (!row || !ON_AIR_QUESTION_STATUSES.includes(row.status))
        return { code: "LIVE_QUESTION_NOT_FOUND", message: "Approve a question before lining it up." };
    } else if (view === "lower-third") {
      if (!findLiveRoomCredit(this.store, session, itemId)) return LIVE_CREDIT_NOT_FOUND;
    } else if (!this.polls.poll(itemId)) {
      return { code: "LIVE_POLL_NOT_FOUND", message: "That poll is no longer available." };
    }
    return null;
  }

  /** Lines an item up after the others of its view; an item already lined up stays where it is. */
  enqueue(operator: Operator, session: LiveRoomSession, view: LiveStageView, itemId: string, at: string) {
    const refusal = this.queueable(session, view, itemId);
    if (refusal) return refusal;
    const queue = this.store.queue();
    if (queue[view].includes(itemId)) return { messages: [] };
    if (queue[view].length >= LIVE_ROOM_POLICY.queueMaxLength)
      return { code: "LIVE_QUEUE_FULL", message: `The ${VIEW_NAME[view]} lineup is full.` };
    return this.saveQueue(operator, { ...queue, [view]: [...queue[view], itemId] }, at);
  }

  dequeue(operator: Operator, view: LiveStageView, itemId: string, at: string): LiveControlOutcome {
    const queue = this.store.queue();
    if (!queue[view].includes(itemId)) return { messages: [] };
    return this.saveQueue(operator, { ...queue, [view]: queue[view].filter((id) => id !== itemId) }, at);
  }

  move(operator: Operator, view: LiveStageView, itemId: string, direction: "up" | "down", at: string) {
    const queue = this.store.queue();
    const items = [...queue[view]];
    const from = items.indexOf(itemId);
    const to = from + (direction === "up" ? -1 : 1);
    if (from < 0 || to < 0 || to >= items.length) return { messages: [] };
    [items[from], items[to]] = [items[to], items[from]];
    return this.saveQueue(operator, { ...queue, [view]: items }, at);
  }

  /** Takes the first lined-up item of a view out of the lineup, for the caller to put on air. */
  takeNext(
    operator: Operator,
    view: LiveStageView,
    at: string,
  ): { itemId: string; message: LiveRoomServerMessage } | LiveRefusal {
    const queue = this.store.queue();
    const [itemId, ...rest] = queue[view];
    if (!itemId) return { code: "LIVE_QUEUE_EMPTY", message: `No ${VIEW_NAME[view]} is lined up next.` };
    const next = { ...queue, [view]: rest, change: { operatorName: operator.name, at } };
    this.store.saveQueue(next);
    return { itemId, message: { type: "queue.changed", queue: next } };
  }

  private saveQueue(operator: Operator, queue: LiveQueue, at: string): LiveControlOutcome {
    const next = { ...queue, change: { operatorName: operator.name, at } };
    this.store.saveQueue(next);
    return { messages: [{ type: "queue.changed", queue: next }] };
  }
}
