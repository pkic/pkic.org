import { useState } from "preact/hooks";
import { livePanelistsSchema, type LivePanelists } from "../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { DEFAULT_LIVE_PANELISTS } from "../../../../../../../shared/live-scene-fill";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LiveGraphicSettingsDialog } from "./LiveGraphicSettingsDialog";
import { useLiveGraphicSettings } from "./live-graphic-settings";
import type { LiveTargets } from "./live-output-targets";

const LAYOUT_LABELS: Record<LivePanelists["layout"], string> = {
  panel: "Title and speakers in a row",
  list: "Title and speakers in one column",
  columns: "Title and speakers in two columns",
  title: "Title only",
};

/** The session graphic: its title, with its speakers (moderator included) or alone, and its abstract when asked. */
export function LivePanelistControls({ targets }: { targets: LiveTargets }) {
  const shown = targets.state.preview.panelists ?? (targets.programActive ? targets.state.stage.panelists : null);
  // The row follows the session graphic an output shows; saving its settings changes it there.
  const { settings, save, saves } = useLiveGraphicSettings<LivePanelists>(
    targets,
    shown,
    DEFAULT_LIVE_PANELISTS,
    (panelists) => ({
      kind: "panelists",
      panelists,
    }),
    "panelists",
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LivePanelists>(settings);
  const form = useContractForm(livePanelistsSchema, draft);
  const hasAbstract = Boolean(targets.state.session.abstract);
  return (
    <LiveGraphicRow
      name="Session"
      outputs={{ targets, subject: "session graphic", layer: { kind: "panelists", panelists: settings } }}
      detail={settings.abstract ? `${LAYOUT_LABELS[settings.layout]} · with abstract` : LAYOUT_LABELS[settings.layout]}
      settings={{
        label: "Session graphic settings",
        onOpen: () => {
          setDraft(settings);
          setOpen(true);
        },
      }}
    >
      {open && (
        <LiveGraphicSettingsDialog
          title="Session graphic"
          saves={saves}
          form={form}
          save={save}
          onClose={() => setOpen(false)}
        >
          <Field label="Show" {...form.of("layout")}>
            {(control) => (
              <Select
                {...control}
                value={draft.layout}
                onChange={(event) => {
                  const layout = livePanelistsSchema.shape.layout.parse(event.currentTarget.value);
                  setDraft((previous) => ({ ...previous, layout }));
                }}
              >
                {(Object.keys(LAYOUT_LABELS) as Array<LivePanelists["layout"]>).map((value) => (
                  <option key={value} value={value}>
                    {LAYOUT_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Checkbox
            label="Show the abstract"
            hint={hasAbstract ? undefined : "This session has no abstract."}
            checked={draft.abstract ?? false}
            {...form.of("abstract")}
            onChange={(event) => {
              const abstract = event.currentTarget.checked;
              setDraft((previous) => ({ ...previous, abstract }));
            }}
          />
        </LiveGraphicSettingsDialog>
      )}
    </LiveGraphicRow>
  );
}
