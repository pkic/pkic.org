import { useHashQueryParam } from "../../../../../../hooks/useHashQueryParam";
import type { ComponentChildren } from "preact";
import { useId } from "preact/hooks";
import { TabList } from "../../../../../../ui/TabList";

/** Shows one canonical source collection at a time without duplicating its controls. */
export function AgendaSessionSources({
  accepted,
  unscheduled,
}: {
  accepted?: ComponentChildren;
  unscheduled: ComponentChildren;
}) {
  const prefix = useId();
  const hasAccepted = accepted !== undefined && accepted !== null && accepted !== false;
  const [selected, setSelected] = useHashQueryParam("sessionSource", hasAccepted ? "accepted" : "unscheduled", [
    "accepted",
    "unscheduled",
  ] as const);
  const active = hasAccepted ? selected : "unscheduled";
  const items = [
    ...(hasAccepted ? [{ id: "accepted", label: "Accepted proposals", panelId: `${prefix}-accepted-panel` }] : []),
    { id: "unscheduled", label: "Unscheduled sessions", panelId: `${prefix}-unscheduled-panel` },
  ];

  return (
    <div class="pk-stack">
      <TabList
        items={items}
        activeId={active}
        onSelect={(id) => setSelected(id === "accepted" ? "accepted" : "unscheduled")}
        label="Session sources"
        idPrefix={prefix}
      />
      <div
        key={active}
        id={`${prefix}-${active}-panel`}
        role="tabpanel"
        aria-labelledby={`${prefix}-${active}`}
        tabIndex={0}
        class="pk-agenda-editor__source-scroll"
      >
        {active === "accepted" ? accepted : unscheduled}
      </div>
    </div>
  );
}
