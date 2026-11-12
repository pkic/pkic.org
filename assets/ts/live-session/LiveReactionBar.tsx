import { useEffect, useRef, useState } from "preact/hooks";
import { LIVE_REACTIONS, LIVE_ROOM_POLICY, takeLiveAllowance } from "../../shared/live-session-policy";
import { liveReactionSchema, type LiveRoomClientMessage } from "../../shared/schemas/live-session-room";
import type { LiveRoomState } from "./live-room-state";
import { ReactionToolbar } from "./ReactionToolbar";
import "./LiveReactionBar.css";

/** What the bar says, quietly, when reactions come faster than the room takes them. */
export const LIVE_REACTION_PAUSED = "Reactions paused for a few seconds.";
const RATE_LIMITED = "LIVE_ROOM_RATE_LIMITED";

/**
 * The session's quick reactions, under the stream: each press sends one, and
 * the room floats it up the outputs an operator turned reactions on for. The
 * bar keeps the room's own allowance, so it pauses itself before the room
 * refuses, and says so in a quiet status line rather than an alert.
 */
export function LiveReactionBar({
  send,
  refusal,
  disabled = false,
}: {
  send: (message: LiveRoomClientMessage) => boolean;
  /** The room's latest refusal; a rate limit the room counted differently pauses the bar too. */
  refusal: LiveRoomState["refusal"];
  disabled?: boolean;
}) {
  const sent = useRef<number[]>([]);
  const [paused, setPaused] = useState(false);
  const resume = useRef<ReturnType<typeof setTimeout>>();
  const pause = () => {
    setPaused(true);
    clearTimeout(resume.current);
    // The oldest reaction leaves the window first; until then the room would refuse the next.
    const oldest = sent.current[0] ?? Date.now();
    const wait = Math.max(1_000, oldest + LIVE_ROOM_POLICY.reactionsPerPerson.windowSeconds * 1000 - Date.now());
    resume.current = setTimeout(() => setPaused(false), wait);
  };
  const seen = useRef(refusal?.sequence ?? 0);
  useEffect(() => {
    if (!refusal || refusal.sequence === seen.current) return;
    seen.current = refusal.sequence;
    if (refusal.code === RATE_LIMITED) pause();
  }, [refusal]);
  useEffect(() => () => clearTimeout(resume.current), []);
  return (
    <div class="pk-live-reactions">
      <ReactionToolbar
        label="React to this session"
        reactions={LIVE_REACTIONS}
        disabled={disabled}
        onChoose={(reaction) => {
          if (paused) return;
          if (!takeLiveAllowance(sent.current, Date.now(), LIVE_ROOM_POLICY.reactionsPerPerson)) return pause();
          send({ type: "reaction.send", reaction: liveReactionSchema.parse(reaction.id) });
        }}
      />
      <p class="pk-live-reactions__status" role="status">
        {paused ? LIVE_REACTION_PAUSED : ""}
      </p>
    </div>
  );
}
