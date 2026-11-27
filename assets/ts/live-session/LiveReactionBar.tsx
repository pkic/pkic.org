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
/** How long a sent reaction rises from its button; the stream shows it later, so the bar answers at once. */
const SENT_FLOAT_MS = 900;
/** The most sent reactions in the air at once, so fast clicking never piles them up. */
const SENT_FLOATS_MAX = 6;

interface SentFloat {
  id: number;
  emoji: string;
  /** The center of the button it leaves, from the bar's own corner. */
  x: number;
  y: number;
}

/** The reactions this viewer just sent, each rising from where it was pressed and gone after a moment. */
function useSentFloats() {
  const bar = useRef<HTMLDivElement>(null);
  const [floats, setFloats] = useState<SentFloat[]>([]);
  const next = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const launch = (emoji: string, from: Element | null) => {
    const host = bar.current;
    // From the picker, the reaction leaves the button that opened it.
    const anchor = from ?? host?.querySelector(".pk-live-reactions__more") ?? null;
    if (!host || !anchor) return;
    const box = anchor.getBoundingClientRect();
    const origin = host.getBoundingClientRect();
    const id = ++next.current;
    const float = { id, emoji, x: box.left - origin.left + box.width / 2, y: box.top - origin.top + box.height / 2 };
    setFloats((current) => [...current.slice(1 - SENT_FLOATS_MAX), float]);
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setFloats((current) => current.filter((item) => item.id !== id));
    }, SENT_FLOAT_MS);
    timers.current.add(timer);
  };
  return { bar, floats, launch };
}

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
  const sentFloats = useSentFloats();
  const react = (reaction: string, from: Element | null = null) => {
    if (paused) return;
    if (!takeLiveAllowance(sent.current, Date.now(), LIVE_ROOM_POLICY.reactionsPerPerson)) return pause();
    const chosen = liveReactionSchema.parse(reaction);
    if (!send({ type: "reaction.send", reaction: chosen })) return;
    const emoji = LIVE_REACTIONS.find((candidate) => candidate.id === chosen)?.emoji;
    if (emoji) sentFloats.launch(emoji, from);
  };
  const [first, ...more] = LIVE_REACTIONS;
  return (
    <div
      ref={sentFloats.bar}
      class={["pk-live-reactions", compact && "pk-live-reactions--compact"].filter(Boolean).join(" ")}
    >
      <ReactionToolbar
        label="React to this session"
        reactions={compact ? [first] : LIVE_REACTIONS}
        disabled={disabled}
        onChoose={(reaction: ReactionChoice, _on, button) => react(reaction.id, button)}
      />
      {compact && !disabled ? (
        <ReactionPicker
          label="More reactions"
          title="More reactions"
          triggerClass="pk-live-reactions__more"
          reactions={more}
          onReact={(reaction) => react(reaction)}
        >
          <IconReactionAdd />
        </ReactionPicker>
      ) : null}
      <p class="pk-live-reactions__status" role="status">
        {paused ? LIVE_REACTION_PAUSED : ""}
      </p>
      {sentFloats.floats.map((float) => (
        <span
          key={float.id}
          aria-hidden="true"
          class="pk-live-reactions__sent"
          ref={(node) => {
            node?.style.setProperty("inset-inline-start", `${float.x}px`);
            node?.style.setProperty("inset-block-start", `${float.y}px`);
          }}
        >
          {float.emoji}
        </span>
      ))}
    </div>
  );
}
