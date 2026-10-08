import type { ComponentChildren } from "preact";
import { Tabs } from "../../../../../../components/Tabs";
import "./AgendaWorkspaceHeader.css";
const views = ["agenda", "sessions", "locations", "library", "staffing"] as const;
const tabViews = views.filter((view) => view !== "library");
export type AgendaWorkspaceView = (typeof views)[number];
const labels: Record<AgendaWorkspaceView, string> = {
  agenda: "Agenda",
  sessions: "Schedule",
  locations: "Locations",
  library: "Reuse a session",
  staffing: "Shifts",
};
const tabPrefix = "agenda-workspace-tab";
const panelId = (view: AgendaWorkspaceView) => `agenda-workspace-panel-${view}`;

/** The record-level menu applies to the whole agenda; local tabs switch its existing panels. */
export function AgendaWorkspaceHeader({
  view,
  onViewChange,
  actions,
  sources,
}: {
  view: AgendaWorkspaceView;
  onViewChange: (view: AgendaWorkspaceView) => void;
  actions: ComponentChildren;
  sources?: ComponentChildren;
}) {
  return (
    <div class="pk-agenda-workspace-navigation">
      <div class="pk-agenda-workspace-header">
        <Tabs
          label="Agenda views"
          idPrefix={tabPrefix}
          active={view === "library" ? "agenda" : view}
          onChange={(value) => {
            const selected = views.find((candidate) => candidate === value);
            if (selected) onViewChange(selected);
          }}
          items={tabViews.map((key) => ({ key, label: labels[key], panelId: panelId(key) }))}
        />
        <div class="pk-agenda-workspace-header__actions">
          {sources}
          {actions}
        </div>
      </div>
    </div>
  );
}

/** Every tab controls a real panel; only the active panel mounts its potentially expensive content. */
export function AgendaWorkspacePanels({ view, children }: { view: AgendaWorkspaceView; children: ComponentChildren }) {
  return (
    <>
      {views.map((value) => (
        <div
          role={value === "library" ? "region" : "tabpanel"}
          id={panelId(value)}
          aria-labelledby={value === "library" ? undefined : `${tabPrefix}-${value}`}
          aria-label={value === "library" ? labels.library : undefined}
          hidden={value !== view}
          class="pk-stack"
        >
          {value === view ? children : null}
        </div>
      ))}
    </>
  );
}
