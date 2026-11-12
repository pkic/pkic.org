/**
 * ReactionToolbar: one horizontal row of emoji buttons, the shape every chat
 * and live-video app uses for reactions. It is a toolbar, not a menu, with
 * one tab stop: Left/Right move and wrap, Home/End jump to the ends. The chat
 * message picker shows it in a popover as on/off toggles; the session's
 * reaction bar shows it in place, where each press sends one reaction.
 */
import type { JSX, Ref } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import "./ReactionToolbar.css";

export interface ReactionChoice {
  id: string;
  label: string;
  emoji: string;
}

export function ReactionToolbar({
  id,
  label,
  reactions,
  pressed,
  autoFocus = false,
  disabled = false,
  class: className,
  toolbarRef,
  onKeyDown,
  onChoose,
}: {
  id?: string;
  /** The toolbar's accessible name. */
  label: string;
  reactions: readonly ReactionChoice[];
  /** Toggles: the reactions already on. Left out, each button is a plain action. */
  pressed?: readonly string[];
  /** Moves focus to the first reaction as the toolbar appears, as a popover does. */
  autoFocus?: boolean;
  disabled?: boolean;
  class?: string;
  toolbarRef?: Ref<HTMLDivElement>;
  /** Keys the toolbar does not use itself, such as Escape and Tab in a popover. */
  onKeyDown?: (event: JSX.TargetedKeyboardEvent<HTMLDivElement>) => void;
  onChoose: (reaction: ReactionChoice, on: boolean) => void;
}) {
  const [active, setActive] = useState(0);
  const [moved, setMoved] = useState(autoFocus);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    if (moved) buttons.current[active]?.focus({ preventScroll: true });
  }, [moved, active]);

  function move(next: number) {
    setActive(next);
    setMoved(true);
  }

  function keyDown(event: JSX.TargetedKeyboardEvent<HTMLDivElement>) {
    const last = reactions.length - 1;
    const step: Record<string, number> = {
      ArrowRight: active >= last ? 0 : active + 1,
      ArrowLeft: active <= 0 ? last : active - 1,
      Home: 0,
      End: last,
    };
    if (event.key in step) {
      event.preventDefault();
      event.stopPropagation();
      move(step[event.key]!);
      return;
    }
    onKeyDown?.(event);
  }

  return (
    <div
      id={id}
      ref={toolbarRef}
      role="toolbar"
      tabIndex={-1}
      aria-label={label}
      aria-orientation="horizontal"
      class={["pk-reaction-toolbar", className].filter(Boolean).join(" ")}
      onKeyDown={keyDown}
    >
      {reactions.map((reaction, index) => {
        const on = pressed?.includes(reaction.id) ?? false;
        return (
          <button
            key={reaction.id}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            class="pk-reaction-toolbar__button"
            aria-label={reaction.label}
            aria-pressed={pressed ? (on ? "true" : "false") : undefined}
            title={reaction.label}
            tabIndex={index === active ? 0 : -1}
            disabled={disabled}
            onFocus={() => setActive(index)}
            onClick={() => onChoose(reaction, !on)}
          >
            <span aria-hidden="true">{reaction.emoji}</span>
          </button>
        );
      })}
    </div>
  );
}
