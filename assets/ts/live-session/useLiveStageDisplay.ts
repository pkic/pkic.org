import { useEffect, useRef, useState } from "preact/hooks";
import { liveStageDisplayPlan, type LiveStageDisplayPlan } from "../../shared/live-stage-display-plan";
import { LIVE_REACTIONS, type LiveReactionId } from "../../shared/live-session-policy";
import type { LiveRoomState } from "./live-room-state";
import { useLiveTimerNow } from "./useLiveCountdown";

/**
 * What the stage display shows now, from the room as it is (not projected
 * onto one output): its own composition, Program, the question lined up in
 * Preview, and its settings. It ticks every second, since its clock does.
 */
export function useLiveStageDisplayPlan(state: LiveRoomState, roomId?: string): LiveStageDisplayPlan {
  const now = useLiveTimerNow(true);
  const next = state.stageDisplayNext;
  return liveStageDisplayPlan({
    session: state.session,
    own: state.outputs["stage-display"],
    program: state.stage,
    next,
    // Operators' monitors read the votes from the question list; a stage display source receives them with the question.
    nextVotes: next
      ? (state.questions.find((question) => question.id === next.id)?.votes ?? state.stageDisplayNextVotes)
      : null,
    polls: state.polls,
    timers: state.timers,
    speakerMessage: state.speakerMessage,
    settings: state.stageDisplaySettings,
    roomId,
    now,
  });
}

/** How long reactions stay in the top row after the last burst arrived. */
const REACTION_HOLD_MS = 3000;

export interface LiveStageReaction {
  id: LiveReactionId;
  emoji: string;
  label: string;
  count: number;
}

/**
 * The reactions arriving now, a count per kind, most first and at most three
 * kinds. Each burst adds to the counts; they clear a few seconds after the
 * last one, so the row is empty while nothing arrives.
 */
export function useLiveStageReactions(burst: LiveRoomState["burst"], enabled: boolean): LiveStageReaction[] {
  const [counts, setCounts] = useState<Partial<Record<LiveReactionId, number>>>({});
  const latest = useRef(burst);
  latest.current = burst;
  const sequence = burst?.sequence;
  useEffect(() => {
    const arrived = latest.current?.counts;
    // A snapshot clears the burst; clear the row with it rather than keep stale counts.
    if (!arrived) return setCounts((current) => (Object.keys(current).length ? {} : current));
    setCounts((current) => {
      const next = { ...current };
      for (const [id, count] of Object.entries(arrived) as Array<[LiveReactionId, number]>)
        next[id] = (next[id] ?? 0) + count;
      return next;
    });
    const clear = setTimeout(() => setCounts({}), REACTION_HOLD_MS);
    return () => clearTimeout(clear);
  }, [sequence]);
  if (!enabled) return [];
  return LIVE_REACTIONS.filter((reaction) => counts[reaction.id])
    .map((reaction) => ({ ...reaction, count: counts[reaction.id]! }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 3);
}
