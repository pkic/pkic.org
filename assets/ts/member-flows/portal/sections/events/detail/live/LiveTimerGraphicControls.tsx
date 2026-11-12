import { useEffect, useState } from "preact/hooks";
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
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { LIVE_AUX_OUTPUTS } from "../../../../../../../shared/live-room-outputs";
import { liveTimerGraphicReplacements, sendLivePrograms, type LiveTargets } from "./live-output-targets";

const FORMAT_LABELS: Record<LiveTimerGraphic["format"], string> = {
  clock: "Clock (12:34, 1:02:34, 3d 04:12)",
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
          name={`graphic.${field}`}
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
 * How the timer looks wherever it shows: its label, what it reads and in
 * which format, the logo, the look, and its position and size. Controls are
 * named `graphic.<field>` for the form around them.
 */
export function LiveTimerLookFields({
  draft,
  timerName,
  counts,
  of,
  update,
}: {
  draft: LiveTimerGraphic;
  timerName: string;
  /** False for a clock, which reads the time of day in one fixed way. */
  counts: boolean;
  /** The form's presentation for one graphic field. */
  of: (field: keyof LiveTimerGraphic) => FieldPresentation;
  update: <Key extends keyof LiveTimerGraphic>(key: Key, value: LiveTimerGraphic[Key]) => void;
}) {
  return (
    <>
      <Checkbox
        name="graphic.showLabel"
        checked={draft.showLabel}
        onChange={(event) => update("showLabel", event.currentTarget.checked)}
        label="Show a label"
      />
      {draft.showLabel ? (
        <Field label="Label" help="Leave empty to show the timer's name." {...of("label")}>
          {(control) => (
            <TextInput
              {...control}
              name="graphic.label"
              value={draft.label ?? ""}
              placeholder={timerName}
              onInput={(event) => update("label", event.currentTarget.value.trim() ? event.currentTarget.value : null)}
            />
          )}
        </Field>
      ) : null}
      {counts ? (
        <>
          <div class="pk-cluster">
            <ChoiceField
              field="direction"
              label="Shows"
              options={LIVE_TIMER_DIRECTIONS}
              labels={DIRECTION_LABELS}
              draft={draft}
              presentation={of("direction")}
              update={(value) => update("direction", value)}
            />
            <ChoiceField
              field="format"
              label="Format"
              options={LIVE_TIMER_FORMATS}
              labels={FORMAT_LABELS}
              draft={draft}
              presentation={of("format")}
              update={(value) => update("format", value)}
            />
          </div>
          {draft.format === "custom" ? (
            <Field
              label="Custom duration"
              help="Use {{years}}, {{months}}, {{days}}, {{hours}}, {{minutes}} and {{seconds}}. Years are 365 days; months are 30 days."
              {...of("customFormat")}
            >
              {(control) => (
                <TextInput
                  {...control}
                  name="graphic.customFormat"
                  value={draft.customFormat}
                  onInput={(event) => update("customFormat", event.currentTarget.value)}
                />
              )}
            </Field>
          ) : null}
        </>
      ) : null}
      <Checkbox
        name="graphic.showLogo"
        label="Show logo"
        checked={draft.showLogo}
        onChange={(event) => update("showLogo", event.currentTarget.checked)}
        {...of("showLogo")}
      />
      <div class="pk-cluster">
        <ChoiceField
          field="presentation"
          label="Look"
          options={LIVE_TIMER_PRESENTATIONS}
          labels={PRESENTATION_LABELS}
          draft={draft}
          presentation={of("presentation")}
          update={(value) => update("presentation", value)}
        />
        <ChoiceField
          field="placement"
          label="Position"
          options={LIVE_TIMER_PLACEMENTS}
          labels={PLACEMENT_LABELS}
          draft={draft}
          presentation={of("placement")}
          update={(value) => update("placement", value)}
        />
        <ChoiceField
          field="size"
          label="Size"
          options={LIVE_TIMER_SIZES}
          labels={SIZE_LABELS}
          draft={draft}
          presentation={of("size")}
          update={(value) => update("size", value)}
        />
      </div>
    </>
  );
}

/**
 * One timer's graphic as this desk sends it: what the outputs show, else the
 * defaults. Each output keeps the graphic it was sent, so Program can show
 * the session while the stage display shows another timer. Saving new
 * settings replaces the graphic on every destination that shows it now.
 */
export function useLiveTimerGraphic(targets: LiveTargets, timerId: string) {
  const { state } = targets;
  const on = (graphics: readonly LiveTimerGraphic[]) => graphics.find((graphic) => graphic.timerId === timerId);
  // Preview first, then Program, then a screen such as the stage display, so a timer shown only there keeps its look.
  const shown =
    on(state.preview.timerGraphics) ??
    (targets.programActive
      ? (on(state.stage.timerGraphics) ??
        LIVE_AUX_OUTPUTS.map((output) => on(state.outputs[output].timerGraphics)).find(Boolean))
      : undefined);
  const [graphic, setGraphic] = useState<LiveTimerGraphic>(shown ?? defaultLiveTimerGraphic(timerId));
  // When another operator changes what an output shows, this desk follows it.
  const shownKey = shown ? JSON.stringify(shown) : null;
  useEffect(() => {
    if (shownKey) setGraphic(JSON.parse(shownKey) as LiveTimerGraphic);
  }, [shownKey]);
  /** Whether every output that shows the timer took the new graphic; on failure nothing changes here. */
  const save = (next: LiveTimerGraphic): boolean => {
    if (!sendLivePrograms(targets, liveTimerGraphicReplacements(targets, graphic, next))) return false;
    setGraphic(next);
    return true;
  };
  return { graphic, save };
}
