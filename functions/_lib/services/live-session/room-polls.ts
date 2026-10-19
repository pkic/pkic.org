import { LIVE_POLL_POLICY, livePollTransitionAllowed } from "../../../../assets/shared/live-session-policy";
import {
  LIVE_POLL_ANSWER_REFUSAL,
  livePollLiveEdit,
  readLivePollAnswer,
  type LivePollDraft,
} from "../../../../assets/shared/schemas/live-session-poll";
import type { LiveControlOutcome, LiveRefusal, LiveRoomControls } from "./room-controls";
import type { LivePollRecord, LivePollStore } from "./room-poll-store";
import type { LiveRoomStore } from "./room-store";

type Operator = { userId: string; name: string };

const REFUSALS = {
  missing: { code: "LIVE_POLL_NOT_FOUND", message: "That poll is no longer available." },
  notDraft: { code: "LIVE_POLL_NOT_DRAFT", message: "Only a poll that has not opened yet can be deleted." },
  answersRemoved: {
    code: "LIVE_POLL_ANSWERS_REMOVED",
    message: "Removing a choice deletes the answers it received. Confirm to remove it.",
  },
  full: { code: "LIVE_POLL_LIMIT", message: "This session holds as many polls as it can." },
  anotherOpen: { code: "LIVE_POLL_ALREADY_OPEN", message: "Close the open poll before opening another." },
  transition: { code: "LIVE_POLL_TRANSITION", message: "That poll cannot move to this status." },
  closed: { code: "LIVE_POLL_CLOSED", message: "This poll is not taking votes." },
} satisfies Record<string, LiveRefusal>;

/**
 * A room's polls: operators prepare drafts, open one at a time and close it
 * and may reopen it, correcting the wording at any time; each signed-in participant holds one answer per open poll and may
 * change it until the poll closes. An answer passes the forms answer rules of
 * the poll's question. Every staff change is audited.
 */
export class LiveRoomPolls {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly polls: LivePollStore,
    private readonly controls: LiveRoomControls,
  ) {}

  save(
    operator: Operator,
    pollId: string | null,
    draft: LivePollDraft,
    at: string,
    discardRemovedAnswers = false,
  ): LiveControlOutcome {
    if (pollId === null) {
      if (this.polls.pollCount() >= LIVE_POLL_POLICY.maxPollsPerRoom) return REFUSALS.full;
      const id = crypto.randomUUID();
      this.polls.create(id, draft, operator, at);
      this.store.recordStaffAction(operator.userId, "live_session.poll.created", { pollId: id }, at);
      return { messages: [], polls: [id] };
    }
    const poll = this.polls.poll(pollId);
    if (!poll) return REFUSALS.missing;
    if (poll.status === "draft") {
      this.polls.updateDraft(pollId, draft, operator, at);
      this.store.recordStaffAction(operator.userId, "live_session.poll.updated", { pollId }, at);
      return { messages: [], polls: [pollId] };
    }
    return this.editLive(operator, poll, draft, discardRemovedAnswers, at);
  }

  /**
   * Corrects a poll people may have answered: its wording changes for
   * everyone at once and every answer stays with its choice. A removed choice
   * drops its answers, which the operator must have confirmed.
   */
  private editLive(
    operator: Operator,
    poll: LivePollRecord,
    draft: LivePollDraft,
    discardRemovedAnswers: boolean,
    at: string,
  ): LiveControlOutcome {
    const edit = livePollLiveEdit(poll.field, draft.field);
    if (edit.problem) return { code: "LIVE_POLL_ANSWER_TYPE_FIXED", message: edit.problem };
    const answered = edit.removedValues.filter((value) => (poll.tallies.get(value) ?? 0) > 0);
    if (answered.length && !discardRemovedAnswers) return REFUSALS.answersRemoved;
    this.polls.updateLive(poll.id, draft, edit.removedValues, operator, at);
    this.store.recordStaffAction(
      operator.userId,
      "live_session.poll.edited",
      { pollId: poll.id, removedChoices: edit.removedValues.length },
      at,
    );
    return { messages: [], polls: [poll.id] };
  }

  remove(operator: Operator, pollId: string, at: string): LiveControlOutcome {
    const poll = this.polls.poll(pollId);
    if (!poll) return REFUSALS.missing;
    if (poll.status !== "draft") return REFUSALS.notDraft;
    this.polls.deleteDraft(pollId);
    this.store.recordStaffAction(operator.userId, "live_session.poll.deleted", { pollId }, at);
    return {
      messages: [{ type: "poll.removed", pollId }, ...this.controls.withdraw(operator, "poll", pollId, at)],
    };
  }

  setStatus(operator: Operator, pollId: string, status: "open" | "closed", at: string): LiveControlOutcome {
    const poll = this.polls.poll(pollId);
    if (!poll) return REFUSALS.missing;
    if (poll.status === status) return { messages: [] };
    if (!livePollTransitionAllowed(poll.status, status)) return REFUSALS.transition;
    const open = this.polls.openPollId();
    if (status === "open" && open !== null && open !== pollId) return REFUSALS.anotherOpen;
    this.polls.setStatus(pollId, status, operator, at);
    this.store.recordStaffAction(
      operator.userId,
      status === "open" ? "live_session.poll.opened" : "live_session.poll.closed",
      { pollId },
      at,
    );
    return { messages: [], polls: [pollId] };
  }

  /**
   * "Next poll": closes the poll that is open, opens the next one if it is
   * still a draft, and puts it on air, so one key moves the room along.
   */
  advanceTo(operator: Operator, pollId: string, at: string): LiveControlOutcome {
    const poll = this.polls.poll(pollId);
    if (!poll) return REFUSALS.missing;
    const touched: string[] = [];
    const open = this.polls.openPollId();
    if (open !== null && open !== pollId) {
      const closed = this.setStatus(operator, open, "closed", at);
      if ("code" in closed) return closed;
      touched.push(open);
    }
    if (poll.status === "draft") {
      const opened = this.setStatus(operator, pollId, "open", at);
      if ("code" in opened) return opened;
    }
    const shown = this.controls.showPoll(operator, pollId, at);
    if ("code" in shown) return shown;
    return { messages: shown.messages, polls: [...touched, ...(shown.polls ?? []), pollId] };
  }

  vote(userId: string, pollId: string, answer: unknown): LiveRefusal | null {
    const poll = this.polls.poll(pollId);
    if (!poll || poll.status === "draft") return REFUSALS.missing;
    if (poll.status !== "open") return REFUSALS.closed;
    const read = readLivePollAnswer(poll.field, answer);
    if (read.problem !== null) return { code: LIVE_POLL_ANSWER_REFUSAL, message: read.problem };
    this.polls.vote(pollId, userId, read.answer);
    return null;
  }
}
