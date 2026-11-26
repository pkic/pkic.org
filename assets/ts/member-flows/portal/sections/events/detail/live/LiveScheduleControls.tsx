import { useState } from "preact/hooks";
import {
  DEFAULT_LIVE_SCHEDULE_CONFIG,
  liveScheduleConfigSchema,
  type LiveScheduleConfig,
} from "../../../../../../../shared/schemas/live-session-schedule";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LiveGraphicSettingsDialog } from "./LiveGraphicSettingsDialog";
import { useLiveGraphicSettings } from "./live-graphic-settings";
import { LiveGraphicThemeField } from "./LiveGraphicThemeField";
import type { LiveTargets } from "./live-output-targets";

const LAYOUT_LABELS: Record<LiveScheduleConfig["layout"], string> = { cards: "Cards", list: "List" };

/** What comes next, from the approved agenda; the operator chooses only how it looks. */
export function LiveScheduleControls({ targets, detail }: { targets: LiveTargets; detail: string }) {
  const shown = targets.state.preview.schedule ?? (targets.programActive ? targets.state.stage.schedule : null);
  // The row follows the Up next an output shows, always listing every room; saving its settings changes it there.
  const {
    settings: config,
    save,
    saves,
  } = useLiveGraphicSettings<LiveScheduleConfig>(
    targets,
    shown ? { ...shown.config, scope: "all-rooms" } : null,
    { ...DEFAULT_LIVE_SCHEDULE_CONFIG, scope: "all-rooms" },
    (settings) => ({ kind: "schedule", config: settings }),
    "schedule",
  );
  const [draft, setDraft] = useState(config),
    [open, setOpen] = useState(false);
  const form = useContractForm(liveScheduleConfigSchema, draft);
  return (
    <LiveGraphicRow
      name="Up next"
      outputs={{ targets, subject: "up next", layer: { kind: "schedule", config } }}
      detail={detail}
      settings={{
        label: "Up next settings",
        disabled: targets.disabled,
        onOpen: () => {
          setDraft(config);
          setOpen(true);
          form.reset();
        },
      }}
    >
      {open && (
        <LiveGraphicSettingsDialog title="Up next" saves={saves} form={form} save={save} onClose={() => setOpen(false)}>
          <Field label="Layout" {...form.of("layout")}>
            {(control) => (
              <Select
                {...control}
                name="layout"
                value={draft.layout}
                onChange={(event) => {
                  const layout = liveScheduleConfigSchema.shape.layout.parse(event.currentTarget.value);
                  setDraft((previous) => ({ ...previous, layout }));
                }}
              >
                {liveScheduleConfigSchema.shape.layout.unwrap().options.map((layout) => (
                  <option key={layout} value={layout}>
                    {LAYOUT_LABELS[layout]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <LiveGraphicThemeField
            name="theme"
            value={draft.theme}
            presentation={form.of("theme")}
            onChange={(theme) => setDraft((previous) => ({ ...previous, theme }))}
          />
        </LiveGraphicSettingsDialog>
      )}
    </LiveGraphicRow>
  );
}
