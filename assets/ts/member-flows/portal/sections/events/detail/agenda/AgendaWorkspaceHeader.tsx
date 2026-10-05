import type { ComponentChildren } from "preact";
import { Tabs } from "../../../../../../components/Tabs";
import { Panel, PanelHeader } from "../../../../../../ui/Panel";
const views = ["agenda", "sessions", "library", "staffing"] as const;
export type AgendaWorkspaceView = (typeof views)[number];
const labels: Record<AgendaWorkspaceView, string> = {
  agenda: "Agenda",
  sessions: "All sessions",
  library: "Session library",
  staffing: "Block roles",
};
const tabPrefix = "agenda-workspace-tab";
const panelId = (view: AgendaWorkspaceView) => `agenda-workspace-panel-${view}`;

/** The record-level menu applies to the whole agenda; local tabs switch its existing panels. */
export function AgendaWorkspaceHeader({
  view,
  onViewChange,
  actions,
}: {
  view: AgendaWorkspaceView;
  onViewChange: (view: AgendaWorkspaceView) => void;
  actions: ComponentChildren;
}) {
  return (
    <Panel aria-label="Agenda workspace">
      <PanelHeader title="Agenda">{actions}</PanelHeader>
      <Tabs
        label="Agenda views"
        idPrefix={tabPrefix}
        active={view}
        onChange={(value) => {
          const selected = views.find((candidate) => candidate === value);
          if (selected) onViewChange(selected);
        }}
        items={views.map((key) => ({ key, label: labels[key], panelId: panelId(key) }))}
      />
    </Panel>
  );
}

/** Every tab controls a real panel; only the active panel mounts its potentially expensive content. */
export function AgendaWorkspacePanels({ view, children }: { view: AgendaWorkspaceView; children: ComponentChildren }) {
  return (
    <>
      {views.map((value) => (
        <div
          role="tabpanel"
          id={panelId(value)}
          aria-labelledby={`${tabPrefix}-${value}`}
          hidden={value !== view}
          class="pk-stack"
        >
          {value === view ? children : null}
        </div>
      ))}
    </>
  );
}
