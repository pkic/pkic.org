import type { ComponentChildren } from "preact";
import { Tabs } from "../../../../../../components/Tabs";

/** The regular scanner workspace keeps event navigation and the existing event header in place. */
export function ScannerWorkspace({
  view,
  onView,
  collector,
  hidden,
  launch,
  diagnostics,
  recent,
}: {
  view: string;
  onView: (view: string) => void;
  collector: boolean;
  hidden: boolean;
  launch: ComponentChildren;
  diagnostics: ComponentChildren;
  recent: ComponentChildren;
}) {
  return (
    <div class="pk-stack" hidden={hidden}>
      {!collector && (
        <Tabs
          label="Badge scanner views"
          idPrefix="scanner-view"
          active={view}
          onChange={onView}
          items={[
            { key: "scan", label: "Scan", panelId: "scanner-scan-panel" },
            { key: "recent", label: "Recent scans", panelId: "scanner-recent-panel" },
            { key: "diagnostics", label: "Diagnostics", panelId: "scanner-diagnostics-panel" },
          ]}
        />
      )}
      <div
        id="scanner-scan-panel"
        role="tabpanel"
        aria-labelledby={collector ? undefined : "scanner-view-scan"}
        hidden={!collector && view !== "scan"}
      >
        {launch}
      </div>
      {!collector && view === "diagnostics" && (
        <div id="scanner-diagnostics-panel" role="tabpanel" aria-labelledby="scanner-view-diagnostics">
          {diagnostics}
        </div>
      )}
      {!collector && (
        <div id="scanner-recent-panel" role="tabpanel" aria-labelledby="scanner-view-recent" hidden={view !== "recent"}>
          {recent}
        </div>
      )}
    </div>
  );
}
