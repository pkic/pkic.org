import { useEffect, useRef, useState } from "preact/hooks";
import {
  LIVE_OVERLAY_ELEMENTS,
  LIVE_OVERLAY_ELEMENT_COMPOSITIONS,
  LIVE_OVERLAY_ELEMENT_LABELS,
  LIVE_OVERLAY_HORIZONTAL,
  LIVE_OVERLAY_VERTICAL,
  type LiveOverlayComposition,
  type LiveOverlayElement,
  type LiveOverlayElementPlacement,
  type LiveOverlayLayoutElements,
} from "../../../../../../../../shared/schemas/live-overlay-layout";
import type { ContractForm } from "../../../../../../../hooks/useContractForm";
import { Checkbox, Radio } from "../../../../../../../ui/Checkbox";
import { Field } from "../../../../../../../ui/Field";
import { FormSection } from "../../../../../../../ui/FormSection";
import { Select, TextInput } from "../../../../../../../ui/TextControl";
import { Menu } from "../../../../../../../ui/Menu";
import { IconLink, IconUnlink } from "../../../../../../../components/icons";
import {
  LAYOUT_COMPOSITION_LABEL,
  LAYOUT_HORIZONTAL_LABEL,
  LAYOUT_SHARING_LABEL,
  LAYOUT_UNIT_LABEL,
  LAYOUT_VERTICAL_LABEL,
  layoutSharingNote,
} from "./overlay-layout-copy";
import { LAYOUT_UNITS, fieldValue, fractionOf, type LayoutUnit } from "./overlay-layout-editing";

type Change = (element: LiveOverlayElement, patch: Partial<LiveOverlayElementPlacement>) => void;
/** What the link menu does to an element's position: see `overlay-layout-sharing.ts`. */
export type LayoutSharingAction = "unlink" | "relink" | "apply";

/**
 * The link control beside each element: a chain while it shares the event's
 * position, a broken one while this layout places it itself, and a menu to
 * change that.
 */
function SharingMenu({
  element,
  shared,
  disabled,
  onSharing,
}: {
  element: LiveOverlayElement;
  shared: boolean;
  disabled: boolean;
  onSharing: (element: LiveOverlayElement, action: LayoutSharingAction) => void;
}) {
  const label = LIVE_OVERLAY_ELEMENT_LABELS[element];
  return (
    <Menu
      variant="plain"
      align="end"
      triggerClass="pk-layout-elements__link"
      label={`${label} position: ${shared ? LAYOUT_SHARING_LABEL.shared : LAYOUT_SHARING_LABEL.own}`}
      title={shared ? LAYOUT_SHARING_LABEL.shared : LAYOUT_SHARING_LABEL.own}
      heading={shared ? LAYOUT_SHARING_LABEL.shared : LAYOUT_SHARING_LABEL.own}
      items={
        shared
          ? [
              {
                id: "unlink",
                label: "Place differently on this layout",
                disabled,
                onSelect: () => onSharing(element, "unlink"),
              },
            ]
          : [
              { id: "relink", label: "Use shared position", disabled, onSelect: () => onSharing(element, "relink") },
              {
                id: "apply",
                label: "Apply this position to all layouts",
                disabled,
                onSelect: () => onSharing(element, "apply"),
              },
            ]
      }
    >
      {shared ? <IconLink /> : <IconUnlink />}
    </Menu>
  );
}

/** The composition an element is edited on: the first one that draws it. */
export function compositionOf(element: LiveOverlayElement): LiveOverlayComposition {
  return LIVE_OVERLAY_ELEMENT_COMPOSITIONS[element][0]!;
}

/**
 * The element list: picking one with the arrow keys selects its box on the
 * canvas, and each element's Show box decides whether this layout draws it.
 */
export function OverlayLayoutElementList({
  elements,
  selected,
  disabled,
  onSelect,
  onChange,
  onSharing,
}: {
  elements: LiveOverlayLayoutElements;
  selected: LiveOverlayElement;
  disabled: boolean;
  onSelect: (element: LiveOverlayElement) => void;
  onChange: Change;
  onSharing: (element: LiveOverlayElement, action: LayoutSharingAction) => void;
}) {
  return (
    <Field
      label="Elements"
      group
      help="Choose an element to place it on the canvas. A linked element moves on every layout that shares its position."
    >
      {(control) => (
        <div class="pk-layout-elements" aria-describedby={control["aria-describedby"]}>
          {(["program", "stage-display"] as const).map((composition) => (
            <div key={composition} class="pk-layout-elements__group">
              <p class="pk-layout-elements__heading">{LAYOUT_COMPOSITION_LABEL[composition]}</p>
              {LIVE_OVERLAY_ELEMENTS.filter((element) => compositionOf(element) === composition).map((element) => (
                <div
                  key={element}
                  class="pk-layout-elements__row"
                  data-selected={element === selected ? "" : undefined}
                >
                  <Radio
                    name="layoutElement"
                    value={element}
                    checked={element === selected}
                    fill
                    label={LIVE_OVERLAY_ELEMENT_LABELS[element]}
                    onChange={() => onSelect(element)}
                  />
                  <SharingMenu
                    element={element}
                    shared={elements[element].shared}
                    disabled={disabled}
                    onSharing={onSharing}
                  />
                  <Checkbox
                    name={`elements.${element}.visible`}
                    checked={elements[element].visible}
                    disabled={disabled}
                    aria-label={`Show ${LIVE_OVERLAY_ELEMENT_LABELS[element]}`}
                    label="Show"
                    onChange={(event) => onChange(element, { visible: event.currentTarget.checked })}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Field>
  );
}

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

/** The selected element's exact box and its alignment inside the box. */
export function OverlayLayoutInspector({
  element,
  placement,
  unit,
  disabled,
  form,
  sharing,
  onUnit,
  onChange,
}: {
  element: LiveOverlayElement;
  placement: LiveOverlayElementPlacement;
  /** How many of the event's layouts share this element's position. */
  sharing: number;
  unit: LayoutUnit;
  disabled: boolean;
  form: ContractForm<unknown>;
  onUnit: (unit: LayoutUnit) => void;
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
    <FormSection
      layout="stack"
      title={LIVE_OVERLAY_ELEMENT_LABELS[element]}
      description={`Shown on ${LAYOUT_COMPOSITION_LABEL[compositionOf(element)].toLowerCase()}. ${
        placement.shared ? layoutSharingNote(sharing) : "Placed for this layout only."
      }`}
    >
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
    </FormSection>
  );
}
