import { useState } from "preact/hooks";
import { livePanelistsSchema, type LivePanelists } from "../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LiveLayerTargets } from "./LiveLayerTargets";
import type { LiveTargets } from "./live-output-targets";

const LAYOUT_LABELS: Record<LivePanelists["layout"], string> = {
  panel: "Portraits in a row",
  list: "One column",
  columns: "Two columns",
};

/** Every speaker of a panel session, moderator included, in the layout the operator chose. */
export function LivePanelistControls({ targets }: { targets: LiveTargets }) {
  const shown = targets.state.preview.panelists ?? (targets.programActive ? targets.state.stage.panelists : null);
  const [layout, setLayout] = useState<LivePanelists["layout"]>(shown?.layout ?? "panel");
  const [open, setOpen] = useState(false);
  const [draftLayout, setDraftLayout] = useState(layout);
  const form = useContractForm(livePanelistsSchema, { layout: draftLayout });
  return (
    <LiveGraphicRow
      name="Panel"
      detail={`All speakers, moderator included · ${LAYOUT_LABELS[layout].toLowerCase()}`}
      settings={{
        label: "Panel layout",
        onOpen: () => {
          setDraftLayout(layout);
          setOpen(true);
        },
      }}
    >
      <LiveLayerTargets targets={targets} subject="panelists" layer={{ kind: "panelists", panelists: { layout } }} />
      {open && (
        <Dialog
          open
          title="Panel layout"
          confirmLabel="Save"
          onConfirm={() => {
            const checked = form.submit();
            if (checked.data) {
              setLayout(checked.data.layout);
              setOpen(false);
            }
          }}
          onCancel={() => setOpen(false)}
        >
          <Field label="Layout" {...form.of("layout")}>
            {(control) => (
              <Select
                {...control}
                value={draftLayout}
                onChange={(event) => setDraftLayout(livePanelistsSchema.shape.layout.parse(event.currentTarget.value))}
              >
                {(Object.keys(LAYOUT_LABELS) as Array<LivePanelists["layout"]>).map((value) => (
                  <option key={value} value={value}>
                    {LAYOUT_LABELS[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Dialog>
      )}
    </LiveGraphicRow>
  );
}
