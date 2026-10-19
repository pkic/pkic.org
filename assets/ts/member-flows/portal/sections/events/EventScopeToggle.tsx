import { useState } from "preact/hooks";
import type { MenuItem } from "../../../../ui/Menu";
import { Button } from "../../../../ui/Button";
import { IconChevron } from "../../../../ui/MediaIcons";
import "../../../../ui/ButtonToggle.css";

/** Which side of now an event list shows. */
export type EventScope = "upcoming" | "past";

export interface EventScopeState {
  scope: EventScope;
  setScope: (scope: EventScope) => void;
  /**
   * The list contract's instant window for the scope: upcoming is `from`
   * and past is `to`, both at the moment the scope was chosen. Fixing that
   * moment keeps the query stable across re-renders instead of refetching
   * every time the clock moves.
   */
  params: { from: string } | { to: string };
}

/** Upcoming/past state shared by every event list that offers the toggle. */
export function useEventScope(initial: EventScope = "upcoming"): EventScopeState {
  const [state, setState] = useState(() => ({ scope: initial, at: new Date().toISOString() }));
  return {
    scope: state.scope,
    setScope: (scope) => setState({ scope, at: new Date().toISOString() }),
    params: state.scope === "upcoming" ? { from: state.at } : { to: state.at },
  };
}

export function EventScopeToggle({ scope, onChange }: { scope: EventScope; onChange: (scope: EventScope) => void }) {
  return (
    <div class="pk-segmented pk-toolbar-secondary" role="group" aria-label="Events scope">
      <Button
        aria-label="Upcoming"
        title="Upcoming events"
        aria-pressed={scope === "upcoming"}
        onClick={() => onChange("upcoming")}
      >
        <IconChevron class="pk-toolbar-compact-icon" pointing="right" />
        <span class="pk-toolbar-control-label">Upcoming</span>
      </Button>
      <Button aria-label="Past" title="Past events" aria-pressed={scope === "past"} onClick={() => onChange("past")}>
        <IconChevron class="pk-toolbar-compact-icon" pointing="left" />
        <span class="pk-toolbar-control-label">Past</span>
      </Button>
    </div>
  );
}

/** Shared scope commands for the compact event collection menu. */
export function eventScopeActions(scope: EventScope, onChange: (scope: EventScope) => void): MenuItem[] {
  return [
    {
      id: "upcoming-events",
      label: "Upcoming events",
      checked: scope === "upcoming",
      onSelect: () => onChange("upcoming"),
    },
    { id: "past-events", label: "Past events", checked: scope === "past", onSelect: () => onChange("past") },
  ];
}
