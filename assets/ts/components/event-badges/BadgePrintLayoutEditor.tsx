import { badgePrintDesignSchema, type EventBadgeTemplate } from "../../../shared/schemas/event-badge-template";
import { FormSection } from "../../ui/FormSection";
import { useState } from "preact/hooks";
import { BADGE_PRINT_PRESETS, badgePrintPreset, badgePrintPresetIdSchema } from "../../../shared/badge-print-layout";
import {
  badgePrintSettingsForTemplate,
  badgePrintPageSizeSchema,
  badgePrintOrientationSchema,
  badgePrintSidesSchema,
  badgePrintBackPlacementSchema,
  type BadgePrintSettings,
} from "../../../shared/schemas/badge-print-layout";
import { useContractForm } from "../../hooks/useContractForm";
import { Field } from "../../ui/Field";
import { Select, TextInput } from "../../ui/TextControl";
import { Button } from "../../ui/Button";
import { Alert } from "../../ui/Alert";

export function BadgePrintLayoutEditor({
  layout,
  onApply,
  template,
}: {
  layout: BadgePrintSettings;
  template: EventBadgeTemplate | null;
  onApply: (layout: BadgePrintSettings) => void;
}) {
  const [draft, setDraft] = useState(layout);
  const [error, setError] = useState("");
  const form = useContractForm(badgePrintSettingsForTemplate(template), draft);
  function number(label: string, name: string, value: number, update: (value: number) => void) {
    return (
      <Field label={label} {...form.of(name)}>
        {(control) => (
          <TextInput
            {...control}
            name={name}
            type="number"
            step="any"
            value={value}
            onInput={(event) => update(Number(event.currentTarget.value))}
          />
        )}
      </Field>
    );
  }
  return (
    <form
      noValidate
      {...form.handlers}
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = form.submit();
        if (!parsed.data) {
          setError(parsed.message ?? "Check the print layout.");
          return;
        }
        setError("");
        onApply(parsed.data);
      }}
      class="pk-stack"
    >
      <Field label="Print workflow" {...form.of("design")}>
        {(control) => (
          <Select
            {...control}
            name="design"
            value={draft.design}
            onChange={(event) =>
              setDraft({ ...draft, design: badgePrintDesignSchema.parse(event.currentTarget.value) })
            }
          >
            {badgePrintDesignSchema.options.map((value) => (
              <option key={value} value={value}>
                {value === "event_badge" ? "Complete badges" : "Labels only (for preprinted badges)"}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Print preset">
        {(control) => (
          <Select
            {...control}
            value=""
            onChange={(event) => {
              const id = badgePrintPresetIdSchema.parse(event.currentTarget.value);
              setDraft({
                ...badgePrintPreset(id),
                design: template && (id === "a6" || id === "a6_front_back_a4") ? "event_badge" : "name_qr",
              });
              setError("");
            }}
          >
            <option value="" disabled>
              Choose a preset
            </option>
            {BADGE_PRINT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <FormSection title="Paper">
        <Field label="Paper size" {...form.of("page.size")}>
          {(control) => (
            <Select
              {...control}
              name="page.size"
              value={draft.page.size}
              onChange={(event) => {
                const size = badgePrintPageSizeSchema.parse(event.currentTarget.value);
                setDraft({
                  ...draft,
                  page:
                    size === "custom"
                      ? { size, orientation: draft.page.orientation, widthMm: 210, heightMm: 297 }
                      : { size, orientation: draft.page.orientation },
                });
              }}
            >
              {badgePrintPageSizeSchema.options.map((value) => (
                <option key={value} value={value}>
                  {value.toUpperCase()}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Orientation" {...form.of("page.orientation")}>
          {(control) => (
            <Select
              {...control}
              name="page.orientation"
              value={draft.page.orientation}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  page: { ...draft.page, orientation: badgePrintOrientationSchema.parse(event.currentTarget.value) },
                })
              }
            >
              {badgePrintOrientationSchema.options.map((value) => (
                <option key={value} value={value}>
                  {value === "portrait" ? "Portrait" : "Landscape"}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FormSection>
      {draft.page.size === "custom" && (
        <FormSection title="Custom paper dimensions">
          {number("Paper width (mm)", "page.widthMm", draft.page.widthMm, (value) =>
            setDraft({
              ...draft,
              page: {
                size: "custom",
                orientation: draft.page.orientation,
                widthMm: value,
                heightMm: draft.page.size === "custom" ? draft.page.heightMm : 297,
              },
            }),
          )}
          {number("Paper height (mm)", "page.heightMm", draft.page.heightMm, (value) =>
            setDraft({
              ...draft,
              page: {
                size: "custom",
                orientation: draft.page.orientation,
                widthMm: draft.page.size === "custom" ? draft.page.widthMm : 210,
                heightMm: value,
              },
            }),
          )}
        </FormSection>
      )}
      <FormSection title="Badge dimensions">
        {number("Badge width (mm)", "label.widthMm", draft.label.widthMm, (value) =>
          setDraft({ ...draft, label: { ...draft.label, widthMm: value } }),
        )}
        {number("Badge height (mm)", "label.heightMm", draft.label.heightMm, (value) =>
          setDraft({ ...draft, label: { ...draft.label, heightMm: value } }),
        )}
      </FormSection>
      <FormSection title="Sheet population">
        {number("Rows", "rows", draft.rows, (rows) => setDraft({ ...draft, rows }))}
        {number("Columns", "columns", draft.columns, (columns) => setDraft({ ...draft, columns }))}
        {number("Copies per attendee", "copies", draft.copies, (copies) => setDraft({ ...draft, copies }))}
      </FormSection>
      <FormSection title="Spacing">
        {number("Horizontal gap (mm)", "gaps.horizontalMm", draft.gaps.horizontalMm, (value) =>
          setDraft({ ...draft, gaps: { ...draft.gaps, horizontalMm: value } }),
        )}
        {number("Vertical gap (mm)", "gaps.verticalMm", draft.gaps.verticalMm, (value) =>
          setDraft({ ...draft, gaps: { ...draft.gaps, verticalMm: value } }),
        )}
      </FormSection>
      <FormSection title="Margins">
        {(
          [
            ["topMm", "Top"],
            ["rightMm", "Right"],
            ["bottomMm", "Bottom"],
            ["leftMm", "Left"],
          ] as const
        ).map(([key, label]) =>
          number(`${label} margin (mm)`, `margins.${key}`, draft.margins[key], (value) =>
            setDraft({ ...draft, margins: { ...draft.margins, [key]: value } }),
          ),
        )}
      </FormSection>
      <FormSection title="Sides">
        <Field label="Badge sides" {...form.of("sides")}>
          {(control) => (
            <Select
              {...control}
              name="sides"
              value={draft.sides}
              onChange={(event) =>
                setDraft({ ...draft, sides: badgePrintSidesSchema.parse(event.currentTarget.value) })
              }
            >
              {badgePrintSidesSchema.options.map((value) => (
                <option key={value} value={value}>
                  {value === "front_back" ? "Front and back" : value === "front" ? "Front only" : "Back only"}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {draft.sides === "front_back" && (
          <Field label="Back placement" {...form.of("backPlacement")}>
            {(control) => (
              <Select
                {...control}
                name="backPlacement"
                value={draft.backPlacement}
                onChange={(event) =>
                  setDraft({ ...draft, backPlacement: badgePrintBackPlacementSchema.parse(event.currentTarget.value) })
                }
              >
                {badgePrintBackPlacementSchema.options.map((value) => (
                  <option key={value} value={value}>
                    {value === "adjacent" ? "Beside the front on the same sheet" : "Matching separate sheets"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </FormSection>
      {error && <Alert tone="danger">{error}</Alert>}
      <Button type="submit" variant="primary">
        Apply print layout
      </Button>
    </form>
  );
}
