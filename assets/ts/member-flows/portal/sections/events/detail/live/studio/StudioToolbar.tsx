import { IconHelp, IconLayoutReset, IconPlus } from "../../../../../../../components/icons";
import { Button } from "../../../../../../../ui/Button";
import { buttonClasses } from "../../../../../../../ui/button-classes";
import { StrokeIcon } from "../../../../../../../ui/MediaIcons";
import { Menu } from "../../../../../../../ui/Menu";
import { TabList } from "../../../../../../../ui/TabList";
import {
  STUDIO_PANEL_LABELS,
  STUDIO_PANEL_TYPES,
  STUDIO_WORKSPACES,
  STUDIO_WORKSPACE_LABELS,
  addStudioPanel,
  type StudioPanel,
  type StudioWorkspace,
} from "./studio-layout";
import type { StudioChange } from "./useStudioLayout";

/** The layout row: switch workspace, add or reset panels, open the tour, and take the whole screen. */
export function StudioToolbar({
  workspace,
  selectWorkspace,
  panels,
  change,
  reset,
  expanded,
  toggleExpanded,
  touring,
  toggleTour,
}: {
  workspace: StudioWorkspace;
  selectWorkspace: (workspace: StudioWorkspace) => void;
  panels: readonly StudioPanel[];
  change: StudioChange;
  reset: () => void;
  expanded: boolean;
  toggleExpanded: () => void;
  touring: boolean;
  toggleTour: () => void;
}) {
  const present = new Set(panels.map((panel) => panel.type));
  return (
    <div class="pk-studio-toolbar">
      <span class="pk-studio-toolbar__label" aria-hidden="true">
        Layout
      </span>
      <TabList
        label="Layout"
        idPrefix="studio-layout"
        activeId={workspace}
        onSelect={(id) => selectWorkspace(id as StudioWorkspace)}
        items={STUDIO_WORKSPACES.map((id) => ({ id, label: STUDIO_WORKSPACE_LABELS[id] }))}
      />
      <div class="pk-studio-toolbar__end">
        <Menu
          variant="plain"
          label="Add panel"
          title={"Add panel\nAdd a panel you closed, or another monitor, to this workspace."}
          heading="Add panel"
          triggerClass={buttonClasses({ icon: true }, undefined)}
          items={STUDIO_PANEL_TYPES.map((type) => ({
            id: type,
            label: type === "monitor" ? "Monitor (any output)" : STUDIO_PANEL_LABELS[type],
            disabled: type !== "monitor" && present.has(type),
            onSelect: () => change((current) => addStudioPanel(current, type, `${workspace}-${type}-${Date.now()}`)),
          }))}
        >
          <IconPlus />
        </Menu>
        <Button
          icon
          aria-label="Reset layout"
          title={"Reset layout\nPut this workspace's panels back where they started. Nothing on air changes."}
          onClick={reset}
        >
          <IconLayoutReset />
        </Button>
        <Button
          icon
          data-tour-trigger
          aria-expanded={touring}
          aria-label="Studio help"
          title={"Studio help\nA short tour of how the studio works."}
          onClick={toggleTour}
        >
          <IconHelp />
        </Button>
        <Button
          icon
          aria-pressed={expanded}
          aria-label={expanded ? "Exit full screen" : "Full screen"}
          title={
            expanded
              ? "Exit full screen\nPut the studio back in the portal page. Shortcut: Esc."
              : "Full screen\nFill the screen with the studio. Nothing on air changes."
          }
          onClick={toggleExpanded}
        >
          <StrokeIcon>
            <path d={expanded ? "M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" : "M6 1H1v5M10 1h5v5M6 15H1v-5M10 15h5v-5"} />
          </StrokeIcon>
        </Button>
      </div>
    </div>
  );
}
