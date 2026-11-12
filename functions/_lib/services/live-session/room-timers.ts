import {
  withoutLiveTimerGraphic,
  adjustLiveTimer,
  configureLiveTimer,
  controlLiveTimer,
  createLiveTimer,
  liveTimerCounts,
} from "../../../../assets/shared/live-timer-policy";
import type { LiveRoomSession, LiveTimer } from "../../../../assets/shared/schemas/live-session-room";
import {
  LIVE_TIMER_MAX,
  type LiveTimerAction,
  type LiveTimerDraft,
  type LiveTimerSettings,
} from "../../../../assets/shared/schemas/live-session-timer";
import type { LiveControlOutcome } from "./room-controls";
import type { LiveRoomOutputs } from "./room-outputs";
import type { LiveRoomStore } from "./room-store";

type Operator = { userId: string; name: string };

const notFound = { code: "LIVE_TIMER_NOT_FOUND", message: "That timer is no longer in this room." } as const;
const clockOnly = {
  code: "LIVE_TIMER_CLOCK",
  message: "A clock shows the time of day. It has nothing to start, reset or adjust.",
} as const;

/**
 * The room's named timers: session timers, countdowns to a time,
 * fixed-length countdowns and stopwatches. Every operator shares them; each
 * change is one write of the whole list and one broadcast, last writer wins.
 */
export class LiveRoomTimers {
  constructor(
    private readonly store: LiveRoomStore,
    private readonly outputs: LiveRoomOutputs,
  ) {}

  add(
    operator: Operator,
    session: LiveRoomSession,
    draft: LiveTimerDraft,
    now: number,
    at: string,
  ): LiveControlOutcome {
    const timers = this.store.timers();
    if (timers.length >= LIVE_TIMER_MAX)
      return { code: "LIVE_TIMER_LIMIT", message: `A room keeps up to ${LIVE_TIMER_MAX} timers. Remove one first.` };
    if (draft.kind === "until" && draft.targetAt && Date.parse(draft.targetAt) <= now)
      return { code: "LIVE_TIMER_TARGET_PAST", message: "Choose a time that is still ahead." };
    const id = crypto.randomUUID().slice(0, 8);
    const timer = { ...createLiveTimer(id, draft, session, now), change: { operatorName: operator.name, at } };
    this.store.recordStaffAction(operator.userId, "live_session.timer.add", { id, ...draft }, at);
    return this.save(timers.concat(timer));
  }

  /** Removes a timer, and takes its graphic off every output that showed it. */
  remove(operator: Operator, session: LiveRoomSession, timerId: string, at: string): LiveControlOutcome {
    const timers = this.store.timers();
    if (!timers.some((timer) => timer.id === timerId)) return notFound;
    this.store.recordStaffAction(operator.userId, "live_session.timer.remove", { timerId }, at);
    const outcome = this.save(timers.filter((timer) => timer.id !== timerId));
    if ("code" in outcome) return outcome;
    const stage = this.store.stage();
    if (stage.timerGraphics.some((graphic) => graphic.timerId === timerId)) {
      const next = { ...stage, timerGraphics: withoutLiveTimerGraphic(stage.timerGraphics, timerId) };
      this.store.saveStage(next);
      outcome.messages.push({ type: "stage.changed", stage: next });
    }
    outcome.messages.push(...this.outputs.withdraw(operator, "timer", timerId, at));
    return outcome;
  }

  control(
    operator: Operator,
    session: LiveRoomSession,
    timerId: string,
    action: LiveTimerAction,
    now: number,
    at: string,
  ): LiveControlOutcome {
    if (this.isClock(timerId)) return clockOnly;
    const outcome = this.update(operator, session, timerId, at, (timer) =>
      controlLiveTimer(timer, session, action, now),
    );
    if (!("code" in outcome))
      this.store.recordStaffAction(operator.userId, "live_session.timer", { timerId, action }, at);
    return outcome;
  }

  /** Changes what a timer does at zero and where its sounds play. */
  configure(
    operator: Operator,
    session: LiveRoomSession,
    timerId: string,
    settings: LiveTimerSettings,
    now: number,
    at: string,
  ): LiveControlOutcome {
    const timer = this.store.timers().find((entry) => entry.id === timerId);
    if (!timer) return notFound;
    const configured = configureLiveTimer(timer, session, settings, now);
    if (!configured)
      return {
        code: "LIVE_TIMER_SETTINGS_UNSUPPORTED",
        message: "This timer cannot do that at zero. Only a countdown from a length resets itself.",
      };
    const outcome = this.update(operator, session, timerId, at, () => configured);
    if (!("code" in outcome))
      this.store.recordStaffAction(operator.userId, "live_session.timer.configure", { timerId, ...settings }, at);
    return outcome;
  }

  adjust(
    operator: Operator,
    session: LiveRoomSession,
    timerId: string,
    deltaSeconds: number,
    now: number,
    at: string,
  ): LiveControlOutcome {
    if (this.isClock(timerId)) return clockOnly;
    const outcome = this.update(operator, session, timerId, at, (timer) =>
      adjustLiveTimer(timer, session, deltaSeconds, now),
    );
    if (!("code" in outcome))
      this.store.recordStaffAction(
        operator.userId,
        "live_session.timer",
        { timerId, action: "adjust", deltaSeconds },
        at,
      );
    return outcome;
  }

  private isClock(timerId: string): boolean {
    const timer = this.store.timers().find((entry) => entry.id === timerId);
    return timer !== undefined && !liveTimerCounts(timer);
  }

  private update(
    operator: Operator,
    session: LiveRoomSession,
    timerId: string,
    at: string,
    change: (timer: LiveTimer) => LiveTimer,
  ): LiveControlOutcome {
    const timers = this.store.timers();
    if (!timers.some((timer) => timer.id === timerId)) return notFound;
    return this.save(
      timers.map((timer) =>
        timer.id === timerId ? { ...change(timer), change: { operatorName: operator.name, at } } : timer,
      ),
    );
  }

  private save(timers: LiveTimer[]): { messages: LiveControlOutcomeMessages } {
    this.store.saveTimers(timers);
    return { messages: [{ type: "timers.changed", timers }] };
  }
}

type LiveControlOutcomeMessages = Extract<LiveControlOutcome, { messages: unknown }>["messages"];
