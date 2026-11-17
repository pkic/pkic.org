import { useEffect, useRef, useState } from "preact/hooks";
import { LIVE_REACTIONS, type LiveReactionId } from "../../shared/live-session-policy";
import { LIVE_REACTION_CROWD_POLICY } from "../../shared/live-reaction-crowd";
import type { LiveRoomState } from "./live-room-state";

const EMOJI = Object.fromEntries(LIVE_REACTIONS.map((reaction) => [reaction.id, reaction.emoji])) as Record<
  LiveReactionId,
  string
>;
/** A float rises for its whole animation, then leaves the lane. */
const FLOAT_MILLISECONDS = 3200;
/** How long a fading count stays drawn while its fade runs. */
const COUNT_FADE_MILLISECONDS = 600;
const LANES = 4;
const { maxFloating, countFromPeople, countHoldSeconds } = LIVE_REACTION_CROWD_POLICY;

type Burst = LiveRoomState["burst"];
type Float = { id: number; emoji: string; lane: number };

/** One quiet float per person who joined, never more than the lane holds at once. */
function useFloats(burst: Burst): Float[] {
  const [floating, setFloating] = useState<Float[]>([]);
  const next = useRef(0);
  const latest = useRef(burst);
  latest.current = burst;
  const sequence = burst?.sequence;
  useEffect(() => {
    const counts = latest.current?.counts;
    if (!counts) return;
    const spawned = (Object.entries(counts) as Array<[LiveReactionId, number]>)
      .flatMap(([reaction, count]) => Array.from({ length: count }, () => EMOJI[reaction]))
      .slice(-maxFloating)
      .map((emoji) => ({ id: (next.current += 1), emoji, lane: next.current % LANES }));
    if (!spawned.length) return;
    // The newest stay: a crowd replaces older floats rather than stacking up.
    setFloating((current) => [...current, ...spawned].slice(-maxFloating));
    const ids = new Set(spawned.map((item) => item.id));
    const clear = setTimeout(
      () => setFloating((current) => current.filter((item) => !ids.has(item.id))),
      FLOAT_MILLISECONDS,
    );
    return () => clearTimeout(clear);
  }, [sequence]);
  return floating;
}

type Crowd = Partial<Record<LiveReactionId, { people: number; at: number }>>;

/**
 * The reactions enough people share right now: shown from the policy's
 * threshold, updated while people keep reacting, and faded a few seconds
 * after the last burst that reached the threshold.
 */
function useCrowdCounts(burst: Burst, enabled: boolean) {
  const [crowd, setCrowd] = useState<Crowd>({});
  const [now, setNow] = useState(() => Date.now());
  const latest = useRef(burst);
  latest.current = burst;
  const sequence = burst?.sequence;
  useEffect(() => {
    const people = latest.current?.people;
    if (!enabled || !people) return;
    const at = Date.now();
    const reached = (Object.entries(people) as Array<[LiveReactionId, number]>).filter(
      ([, count]) => count >= countFromPeople,
    );
    if (!reached.length) return;
    setNow(at);
    setCrowd((current) => ({
      ...current,
      ...Object.fromEntries(reached.map(([id, count]) => [id, { people: count, at }])),
    }));
  }, [sequence, enabled]);
  useEffect(() => {
    const hold = countHoldSeconds * 1000;
    const moments = Object.values(crowd).flatMap((entry) => [
      entry.at + hold,
      entry.at + hold + COUNT_FADE_MILLISECONDS,
    ]);
    const due = moments.filter((moment) => moment > now);
    if (!due.length) {
      if (moments.length) setCrowd({});
      return;
    }
    const timer = setTimeout(() => setNow(Date.now()), Math.min(...due) - now);
    return () => clearTimeout(timer);
  }, [crowd, now]);
  if (!enabled) return [];
  return LIVE_REACTIONS.flatMap((reaction) => {
    const entry = crowd[reaction.id];
    if (!entry || now >= entry.at + countHoldSeconds * 1000 + COUNT_FADE_MILLISECONDS) return [];
    return [{ ...reaction, people: entry.people, fading: now >= entry.at + countHoldSeconds * 1000 }];
  });
}

/**
 * Viewers' reactions over an output: a few faint floats in a narrow lane,
 * fainter the busier it gets, and, when the composition asks for it, a small
 * count of the people sharing a reaction.
 */
export function LiveReactionsOverlay({ burst, showCount }: { burst: Burst; showCount: boolean }) {
  const floating = useFloats(burst);
  const counts = useCrowdCounts(burst, showCount);
  // Custom properties carry the lane's load to the stylesheet, which owns how faint that makes it.
  const lane = useRef<HTMLDivElement>(null);
  useEffect(() => {
    lane.current?.style.setProperty("--pk-live-reaction-load", String(floating.length / maxFloating));
  }, [floating.length]);
  return (
    <div class="pk-live-overlay__reactions" aria-hidden="true">
      <div class="pk-live-overlay__reaction-lane" ref={lane}>
        {floating.map((item) => (
          <span key={item.id} class={`pk-live-overlay__reaction pk-live-overlay__reaction--lane-${item.lane}`}>
            {item.emoji}
          </span>
        ))}
      </div>
      {counts.length ? (
        <div class="pk-live-overlay__reaction-count">
          {counts.map((count) => (
            <span key={count.id} class="pk-live-overlay__reaction-total" data-fading={count.fading || undefined}>
              {count.emoji} {count.people.toLocaleString("en-US")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
