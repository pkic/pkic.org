import { useState } from "preact/hooks";
import {
  LIVE_TIMER_DIRECTIONS,
  LIVE_TIMER_FORMATS,
  LIVE_TIMER_PLACEMENTS,
  LIVE_TIMER_PRESENTATIONS,
  LIVE_TIMER_SIZES,
  defaultLiveTimerGraphic,
  liveTimerGraphicSchema,
  type LiveTimerGraphic,
} from "../../../../../../../shared/schemas/live-session-timer";
import { useContractForm, type FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Alert } from "../../../../../../ui/Alert";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Dialog } from "../../../../../../ui/Dialog";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { LiveGraphicRow } from "./LiveGraphicRow";
import { LiveLayerTargets } from "./LiveLayerTargets";
import type { LiveTargets } from "./live-output-targets";

const FORMAT_LABELS: Record<LiveTimerGraphic["format"], string> = {
  "mm:ss": "Minutes (12:34)",
  "hh:mm:ss": "Hours (01:02:34)",
  ss: "Seconds (754)",
  custom: "Custom duration",
};
const DIRECTION_LABELS: Record<LiveTimerGraphic["direction"], string> = {
  remaining: "Time left",
  elapsed: "Time elapsed",
};
const PRESENTATION_LABELS: Record<LiveTimerGraphic["presentation"], string> = { ring: "Logo ring", digital: "Digital" };
const PLACEMENT_LABELS: Record<LiveTimerGraphic["placement"], string> = {
  layout: "As the source's layout",
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  center: "Center",
};
const SIZE_LABELS: Record<LiveTimerGraphic["size"], string> = { small: "Small", medium: "Medium", large: "Large" };

/** A select over one of the graphic's choice fields, with its labels. */
function ChoiceField<Key extends "format" | "direction" | "presentation" | "placement" | "size">({
  field,
  label,
  options,
  labels,
  draft,
  presentation,
  update,
}: {
  field: Key;
  label: string;
  options: readonly LiveTimerGraphic[Key][];
  labels: Record<LiveTimerGraphic[Key], string>;
  draft: LiveTimerGraphic;
  presentation: FieldPresentation;
  update: (value: LiveTimerGraphic[Key]) => void;
}) {
  return (
    <Field label={label} {...presentation}>
      {(control) => (
        <Select
          {...control}
          name={field}
          value={draft[field]}
          onChange={(event) =>
            update(liveTimerGraphicSchema.shape[field].parse(event.currentTarget.value) as LiveTimerGraphic[Key])
          }
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {labels[option]}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
}

/**
 * The timer graphic: which of the room's timers it shows and how, then where
 * it goes. Each output keeps the graphic it was sent, so Program can show the
 * session while the stage display shows another timer.
 */
export function LiveTimerGraphicControls({ targets, timerId }: { targets: LiveTargets; timerId: string }) {
  const { state } = targets;
  const shown =
    state.preview.timerGraphics.find((graphic) => graphic.timerId === timerId) ??
    (targets.programActive ? state.stage.timerGraphics.find((graphic) => graphic.timerId === timerId) : undefined);
  const [graphic, setGraphic] = useState<LiveTimerGraphic>(shown ?? defaultLiveTimerGraphic(timerId));
  const [draft, setDraft] = useState(graphic);
  const [warning, setWarning] = useState(String(graphic.warningSeconds));
  const [overrun, setOverrun] = useState(String(graphic.overrunSeconds));
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const body = {
    ...draft,
    warningSeconds: warning.trim() ? Number(warning) : null,
    overrunSeconds: overrun.trim() ? Number(overrun) : null,
  };
  const form = useContractForm(liveTimerGraphicSchema, body);
  const timer = state.timers.find((entry) => entry.id === graphic.timerId);
  const update = <Key extends keyof LiveTimerGraphic>(key: Key, value: LiveTimerGraphic[Key]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));
  return (
    <LiveGraphicRow
      name={timer?.name ?? "Timer"}
      detail={timer ? `${timer.name} · ${DIRECTION_LABELS[graphic.direction].toLowerCase()}` : "No timer in this room"}
      settings={{
        label: `${timer?.name ?? "Timer"} graphic settings`,
        disabled: targets.disabled || !timer,
        onOpen: () => {
          setDraft(graphic);
          setWarning(String(graphic.warningSeconds));
          setOverrun(String(graphic.overrunSeconds));
          setError(null);
          form.reset();
          setOpen(true);
        },
      }}
    >
      <LiveLayerTargets targets={targets} subject="timer" layer={{ kind: "timer", graphic }} disabled={!timer} />
      {open ? (
        <Dialog
          open
          title="Timer graphic"
          confirmLabel="Save"
          onCancel={() => setOpen(false)}
          onConfirm={() => {
            const checked = form.submit();
            if (!checked.data) return setError(checked.formMessage);
            setGraphic(checked.data);
            setOpen(false);
          }}
        >
          <form
            noValidate
            {...form.handlers}
            class="pk-stack pk-stack--snug"
            onSubmit={(event) => event.preventDefault()}
          >
            <Checkbox
              name="showLabel"
              checked={draft.showLabel}
              onChange={(event) => update("showLabel", event.currentTarget.checked)}
              label="Show a label"
            />
            {draft.showLabel ? (
              <Field label="Label" help="Leave empty to use the timer's name." {...form.of("label")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="label"
                    value={draft.label ?? ""}
                    placeholder={state.timers.find((entry) => entry.id === draft.timerId)?.name}
                    onInput={(event) =>
                      update("label", event.currentTarget.value.trim() ? event.currentTarget.value : null)
                    }
                  />
                )}
              </Field>
            ) : null}
            <ChoiceField
              field="direction"
              label="Shows"
              options={LIVE_TIMER_DIRECTIONS}
              labels={DIRECTION_LABELS}
              draft={draft}
              presentation={form.of("direction")}
              update={(value) => update("direction", value)}
            />
            <ChoiceField
              field="format"
              label="Format"
              options={LIVE_TIMER_FORMATS}
              labels={FORMAT_LABELS}
              draft={draft}
              presentation={form.of("format")}
              update={(value) => update("format", value)}
            />
            {draft.format === "custom" ? (
              <Field
                label="Custom duration"
                help="Use {{years}}, {{months}}, {{days}}, {{hours}}, {{minutes}} and {{seconds}}. Years are 365 days; months are 30 days."
                {...form.of("customFormat")}
              >
                {(control) => (
                  <TextInput
                    {...control}
                    value={draft.customFormat}
                    onInput={(event) => update("customFormat", event.currentTarget.value)}
                  />
                )}
              </Field>
            ) : null}
            <Checkbox
              label="Show logo"
              checked={draft.showLogo}
              onChange={(event) => update("showLogo", event.currentTarget.checked)}
              {...form.of("showLogo")}
            />
            <div class="pk-cluster">
              <Field label="Warn at (seconds left)" {...form.of("warningSeconds")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="warningSeconds"
                    type="number"
                    min="0"
                    max="3600"
                    inputMode="numeric"
                    value={warning}
                    onInput={(event) => setWarning(event.currentTarget.value)}
                  />
                )}
              </Field>
              <Field label="Overrun after (seconds over)" {...form.of("overrunSeconds")}>
                {(control) => (
                  <TextInput
                    {...control}
                    name="overrunSeconds"
                    type="number"
                    min="0"
                    max="3600"
                    inputMode="numeric"
                    value={overrun}
                    onInput={(event) => setOverrun(event.currentTarget.value)}
                  />
                )}
              </Field>
            </div>
            <ChoiceField
              field="presentation"
              label="Look"
              options={LIVE_TIMER_PRESENTATIONS}
              labels={PRESENTATION_LABELS}
              draft={draft}
              presentation={form.of("presentation")}
              update={(value) => update("presentation", value)}
            />
            <div class="pk-cluster">
              <ChoiceField
                field="placement"
                label="Position"
                options={LIVE_TIMER_PLACEMENTS}
                labels={PLACEMENT_LABELS}
                draft={draft}
                presentation={form.of("placement")}
                update={(value) => update("placement", value)}
              />
              <ChoiceField
                field="size"
                label="Size"
                options={LIVE_TIMER_SIZES}
                labels={SIZE_LABELS}
                draft={draft}
                presentation={form.of("size")}
                update={(value) => update("size", value)}
              />
            </div>
            {error ? <Alert tone="danger">{error}</Alert> : null}
          </form>
        </Dialog>
      ) : null}
    </LiveGraphicRow>
  );
}
