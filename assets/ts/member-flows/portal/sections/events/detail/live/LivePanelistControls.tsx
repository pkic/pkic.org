import { useState } from "preact/hooks";
import { livePanelistsSchema, type LivePanelists } from "../../../../../../../shared/schemas/live-session-room";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { DEFAULT_LIVE_PANELISTS } from "../../../../../../../shared/live-scene-fill";
import { Alert } from "../../../../../../ui/Alert";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LIVE_SETTINGS_NOT_SENT, useLiveGraphicSettings } from "./live-graphic-settings";
import type { LiveTargets } from "./live-output-targets";

const LAYOUT_LABELS: Record<LivePanelists["layout"], string> = {
  panel: "Portraits in a row",
  list: "One column",
  columns: "Two columns",
};

/** Every speaker of a panel session, moderator included, in the layout the operator chose. */
export function LivePanelistControls({ targets }: { targets: LiveTargets }) {
  const shown = targets.state.preview.panelists ?? (targets.programActive ? targets.state.stage.panelists : null);
  // The row follows the panel an output shows; saving its layout changes it there.
  const { settings, save } = useLiveGraphicSettings<LivePanelists>(
    targets,
    shown,
    DEFAULT_LIVE_PANELISTS,
    (panelists) => ({
      kind: "panelists",
      panelists,
    }),
  );
  const { layout } = settings;
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftLayout, setDraftLayout] = useState(layout);
  const form = useContractForm(livePanelistsSchema, { layout: draftLayout });
  return (
    <LiveGraphicRow
      name="Panel"
      outputs={{ targets, subject: "panelists", layer: { kind: "panelists", panelists: { layout } } }}
      detail={`All speakers, moderator included · ${LAYOUT_LABELS[layout].toLowerCase()}`}
      settings={{
        label: "Panel layout",
        onOpen: () => {
          setDraftLayout(layout);
          setError(null);
          setOpen(true);
        },
      }}
    >
      {open && (
        <Dialog
          open
          title="Panel layout"
          confirmLabel="Save"
          onConfirm={() => {
            const checked = form.submit();
            if (!checked.data) return;
            if (!save(checked.data)) return setError(LIVE_SETTINGS_NOT_SENT);
            setOpen(false);
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
          {error ? <Alert tone="danger">{error}</Alert> : null}
        </Dialog>
      )}
    </LiveGraphicRow>
  );
}
