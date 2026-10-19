import type { ComponentChildren } from "preact";
import { EmptyState } from "../../../../../../../ui/EmptyState";
import type { MenuItem } from "../../../../../../../ui/Menu";
import { StudioPanelFrame } from "./StudioPanelFrame";
import { byGridPosition } from "./studio-grid";
import { defaultStudioSize, type StudioPanel, type StudioWorkspace } from "./studio-layout";
import { useStudioGesture } from "./useStudioGesture";
import type { StudioChange } from "./useStudioLayout";
import "./StudioGrid.css";

export interface StudioPanelView {
  title: string;
  heading?: ComponentChildren;
  actions?: ComponentChildren;
  menu?: readonly MenuItem[];
  body: ComponentChildren;
}

/**
 * The workspace's panels on a 12-column dashboard grid, each at its own
 * column, row, width and height. On a narrow screen they stack in one column
 * in reading order: top to bottom, then left to right.
 */
export function StudioGrid({
  workspace,
  panels,
  change,
  render,
}: {
  workspace: StudioWorkspace;
  panels: readonly StudioPanel[];
  change: StudioChange;
  render: (panel: StudioPanel) => StudioPanelView;
}) {
  const gesture = useStudioGesture(panels, change);
  if (!panels.length) return <EmptyState title="All panels are closed" body="Use Add panel to bring them back." />;
  return (
    <div class="pk-studio-grid-frame">
      <div class="pk-studio-grid" ref={gesture.grid}>
        {[...panels].sort(byGridPosition).map((panel) => {
          const view = render(panel);
          return (
            <StudioPanelFrame
              key={panel.id}
              panel={panel}
              panels={panels}
              title={view.title}
              heading={view.heading}
              actions={view.actions}
              menu={view.menu}
              change={change}
              defaultSize={defaultStudioSize(workspace, panel)}
              cell={gesture.register(panel.id)}
              dragHandle={gesture.handlers("move", panel)}
              resizeHandle={(edge) => gesture.handlers("resize", panel, edge)}
            >
              {view.body}
            </StudioPanelFrame>
          );
        })}
        <div class="pk-studio-grid__placeholder" ref={gesture.placeholder} aria-hidden="true" />
      </div>
    </div>
  );
}
