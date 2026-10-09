import { useState } from "preact/hooks";
import { Chip } from "../../../../ui/Chip";

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
    // Two applied-filter toggles, which is what `Chip` is: each is a real
    // button carrying `aria-pressed`, and the pressed state is drawn rather
    // than announced only by an `active` class the design system never had.
    <div class="pk-cluster" role="group" aria-label="Events scope">
      <Chip pressed={scope === "upcoming"} onToggle={() => onChange("upcoming")}>
        Upcoming
      </Chip>
      <Chip pressed={scope === "past"} onToggle={() => onChange("past")}>
        Past
      </Chip>
    </div>
  );
}
