import { useEffect, useRef, useState } from "preact/hooks";
import { LIVE_REACTIONS, LIVE_ROOM_POLICY, takeLiveAllowance } from "../../shared/live-session-policy";
import type { LiveRoomClientMessage } from "../../shared/schemas/live-session-room";
import { liveReactionSchema } from "../../shared/schemas/live-session-reaction";
import type { LiveRoomState } from "./live-room-state";
import { IconReactionAdd } from "../ui/MediaIcons";
import { ReactionPicker } from "./ReactionPicker";
import { ReactionToolbar, type ReactionChoice } from "./ReactionToolbar";
import "./LiveReactionBar.css";

/** What the bar says, quietly, when reactions come faster than the room takes them. */
export const LIVE_REACTION_PAUSED = "Reactions paused for a few seconds.";
const RATE_LIMITED = "LIVE_ROOM_RATE_LIMITED";

/**
 * The session's quick reactions, under the stream: each press sends one, and
 * the room floats it up the outputs an operator turned reactions on for. The
 * bar keeps the room's own allowance, so it pauses itself before the room
 * refuses, and says so in a quiet status line rather than an alert. Compact,
 * on a phone, it keeps applause in reach and the others behind one button,
 * so the session's title keeps the line.
 */
export function LiveReactionBar({
  send,
  refusal,
  disabled = false,
  compact = false,
}: {
  send: (message: LiveRoomClientMessage) => boolean;
  /** The room's latest refusal; a rate limit the room counted differently pauses the bar too. */
  refusal: LiveRoomState["refusal"];
  disabled?: boolean;
  compact?: boolean;
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
  const react = (reaction: string) => {
    if (paused) return;
    if (!takeLiveAllowance(sent.current, Date.now(), LIVE_ROOM_POLICY.reactionsPerPerson)) return pause();
    send({ type: "reaction.send", reaction: liveReactionSchema.parse(reaction) });
  };
  const [first, ...more] = LIVE_REACTIONS;
  return (
    <div class={["pk-live-reactions", compact && "pk-live-reactions--compact"].filter(Boolean).join(" ")}>
      <ReactionToolbar
        label="React to this session"
        reactions={compact ? [first] : LIVE_REACTIONS}
        disabled={disabled}
        onChoose={(reaction: ReactionChoice) => react(reaction.id)}
      />
      {compact && !disabled ? (
        <ReactionPicker
          label="More reactions"
          title="More reactions"
          triggerClass="pk-live-reactions__more"
          reactions={more}
          onReact={react}
        >
          <IconReactionAdd />
        </ReactionPicker>
      ) : null}
      <p class="pk-live-reactions__status" role="status">
        {paused ? LIVE_REACTION_PAUSED : ""}
      </p>
    </div>
  );
}
