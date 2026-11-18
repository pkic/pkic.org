import { useEffect, useRef, useState } from "preact/hooks";
import {
  LIVE_OVERLAY_ELEMENT_LABELS,
  LIVE_OVERLAY_HORIZONTAL,
  LIVE_OVERLAY_VERTICAL,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import type { ContractForm } from "../../../../../../../hooks/useContractForm";
import { Checkbox, Radio } from "../../../../../../../ui/Checkbox";
import { Field } from "../../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import {
  LAYOUT_HORIZONTAL_LABEL,
  LAYOUT_UNIT_LABEL,
  LAYOUT_VERTICAL_LABEL,
  layoutSharingNote,
} from "./overlay-layout-copy";
import { LAYOUT_UNITS, fieldValue, fractionOf, type LayoutUnit } from "./overlay-layout-editing";

type Change = (element: LiveOverlayElement, patch: Partial<LiveOverlayElementPlacement>) => void;

/** A box field in the chosen unit. While it has focus it keeps what is typed; otherwise it follows the box. */
function BoxField({
  label,
  name,
  value,
  axis,
  unit,
  disabled,
  form,
  onValue,
}: {
  label: string;
  name: string;
  value: number;
  axis: "x" | "y";
  unit: LayoutUnit;
  disabled: boolean;
  form: ContractForm<unknown>;
  onValue: (fraction: number) => void;
}) {
  const shown = String(fieldValue(value, axis, unit));
  const [text, setText] = useState(shown);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(shown);
  }, [shown]);
  return (
    <Field label={label} {...form.of(name)}>
      {(control) => (
        <TextInput
          {...control}
          name={name}
          type="number"
          inputMode="decimal"
          step={unit === "percent" ? 0.1 : 1}
          value={text}
          disabled={disabled}
          onFocus={() => {
            editing.current = true;
          }}
          onBlur={() => {
            editing.current = false;
            setText(shown);
          }}
          onInput={(event) => {
            setText(event.currentTarget.value);
            onValue(fractionOf(event.currentTarget.value, axis, unit));
          }}
        />
      )}
    </Field>
  );
}

/**
 * The selected graphic's exact box and its alignment inside the box, in a
 * disclosure under the canvas, with the safe-area guides' switch.
 */
export function OverlayLayoutInspector({
  element,
  placement,
  unit,
  disabled,
  form,
  sharing,
  safeAreas,
  open,
  onOpen,
  onUnit,
  onSafeAreas,
  onChange,
}: {
  element: LiveOverlayElement;
  placement: LiveOverlayElementPlacement;
  /** How many of the event's scenes share this graphic's position. */
  sharing: number;
  unit: LayoutUnit;
  disabled: boolean;
  form: ContractForm<unknown>;
  safeAreas: boolean;
  /** Whether the disclosure is open; the editor opens it when a field in it is refused. */
  open: boolean;
  onOpen: (open: boolean) => void;
  onUnit: (unit: LayoutUnit) => void;
  onSafeAreas: (shown: boolean) => void;
  onChange: Change;
}) {
  const path = `elements.${element}`;
  const box = (key: "x" | "y" | "w" | "h", label: string) => (
    <BoxField
      label={label}
      name={`${path}.${key}`}
      value={placement[key]}
      axis={key === "x" || key === "w" ? "x" : "y"}
      unit={unit}
      disabled={disabled}
      form={form}
      onValue={(fraction) => onChange(element, { [key]: fraction })}
    />
  );
  return (
    <details
      class="pk-layout-inspector"
      open={open}
      onToggle={(event) => onOpen((event.currentTarget as HTMLDetailsElement).open)}
    >
      <summary class="pk-layout-inspector__summary">Exact position of {LIVE_OVERLAY_ELEMENT_LABELS[element]}</summary>
      <div class="pk-layout-inspector__body">
        <p class="pk-small pk-muted">
          {placement.shared ? layoutSharingNote(sharing) : "Placed for this scene only."} Hold Alt while dragging to
          place a box without snapping.
        </p>
        <Field label="Units" group>
          {(control) => (
            <div class="pk-cluster" aria-describedby={control["aria-describedby"]}>
              {LAYOUT_UNITS.map((choice) => (
                <Radio
                  key={choice}
                  name="layoutUnit"
                  value={choice}
                  checked={unit === choice}
                  label={LAYOUT_UNIT_LABEL[choice]}
                  onChange={() => onUnit(choice)}
                />
              ))}
            </div>
          )}
        </Field>
        <div class="pk-layout-inspector__box">
          {box("x", "From left")}
          {box("y", "From top")}
          {box("w", "Width")}
          {box("h", "Height")}
        </div>
        <div class="pk-layout-inspector__box">
          <Field
            label="Horizontal alignment"
            help="Where the graphic sits when it is narrower than its box."
            {...form.of(`${path}.horizontal`)}
          >
            {(control) => (
              <Select
                {...control}
                name={`${path}.horizontal`}
                value={placement.horizontal}
                disabled={disabled}
                onChange={(event) => {
                  const next = LIVE_OVERLAY_HORIZONTAL.find((value) => value === event.currentTarget.value);
                  if (next) onChange(element, { horizontal: next });
                }}
              >
                {LIVE_OVERLAY_HORIZONTAL.map((value) => (
                  <option key={value} value={value}>
                    {LAYOUT_HORIZONTAL_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Vertical alignment"
            help="Where the graphic sits when it is shorter than its box."
            {...form.of(`${path}.vertical`)}
          >
            {(control) => (
              <Select
                {...control}
                name={`${path}.vertical`}
                value={placement.vertical}
                disabled={disabled}
                onChange={(event) => {
                  const next = LIVE_OVERLAY_VERTICAL.find((value) => value === event.currentTarget.value);
                  if (next) onChange(element, { vertical: next });
                }}
              >
                {LIVE_OVERLAY_VERTICAL.map((value) => (
                  <option key={value} value={value}>
                    {LAYOUT_VERTICAL_LABEL[value]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <Checkbox
          label="Show safe areas"
          checked={safeAreas}
          onChange={(event) => onSafeAreas(event.currentTarget.checked)}
        />
      </div>
    </details>
  );
}
