import { useContractForm } from "../../hooks/useContractForm";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { Select, TextInput, Textarea } from "../../ui/TextControl";
import { formFieldRulesSchema, formFieldRulesTextSchema } from "../../../shared/schemas/form-field-rules";
import {
  caps,
  visualRules,
  draftToRawJson,
  rulesToDraftPatch,
  type FieldDraft,
  type VisualizationConfig,
} from "./form-field-draft";
export { buildFieldValidation, type FieldDraft, type FieldType, type VisualizationConfig } from "./form-field-draft";
import "../../ui/Content.css";

// ── constants ─────────────────────────────────────────────────────────────────

const VIZ_OPTIONS: Array<{ value: VisualizationConfig; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "bar", label: "Bar chart" },
  { value: "pie", label: "Pie chart" },
  { value: "wordcloud", label: "Word cloud" },
  { value: "list", label: "Top list" },
];

const UI_WIDGETS = ["", "tags", "checkboxes", "rating_stars", "nps"];
const FIELD_FORMATS = ["", "iso_country", "phone", "professional_profile", "date_range"];

// ── component ─────────────────────────────────────────────────────────────────

export function FieldConfigEditor({
  field,
  index,
  updateField,
}: {
  field: FieldDraft;
  index: number;
  updateField: (index: number, patch: Partial<FieldDraft>) => void;
}) {
  const c = caps(field.fieldType);
  // One contract, two representations: the visual controls are checked as
  // the rules they describe, the JSON editor as the text that has to parse
  // into those same rules. Either way the field rules contract the route
  // parses is what refuses a value, live, on the control it is about.
  const visual = useContractForm(formFieldRulesSchema, visualRules(field));
  const raw = useContractForm(formFieldRulesTextSchema, { validation: field.rawValidationText });

  function toggleMode() {
    if (!field.rawMode) {
      updateField(index, { rawMode: true, rawValidationText: draftToRawJson(field) });
      raw.reset();
      return;
    }
    // The JSON has to be rules the contract accepts before it can be spread
    // over the visual controls; otherwise the editor stays where the operator
    // is, with the refusal on the text.
    const checked = raw.submit();
    if (!checked.data) return;
    updateField(index, rulesToDraftPatch(checked.data.validation, field.fieldType));
    visual.reset();
  }

  /*
   * Two toggle buttons rather than a segmented control of our own: `aria-pressed`
   * is what tells assistive technology which editor is showing, and the primary
   * variant is what shows it to everyone else. The old markup carried neither —
   * it painted an `.active` class and announced two identical plain buttons.
   */
  const modeSwitch = (
    <div class="pk-cluster pk-cluster--between">
      <span class="pk-small">Field configuration</span>
      <div class="pk-cluster" role="group" aria-label="Edit mode">
        <Button
          size="sm"
          variant={field.rawMode ? "secondary" : "primary"}
          aria-pressed={field.rawMode ? "false" : "true"}
          onClick={() => {
            if (field.rawMode) toggleMode();
          }}
        >
          Visual
        </Button>
        <Button
          size="sm"
          variant={field.rawMode ? "primary" : "secondary"}
          aria-pressed={field.rawMode ? "true" : "false"}
          onClick={() => {
            if (!field.rawMode) toggleMode();
          }}
        >
          JSON
        </Button>
      </div>
    </div>
  );

  // ── Raw JSON mode ────────────────────────────────────────────────────────────
  if (field.rawMode) {
    return (
      <div class="pk pk-stack pk-stack--snug" {...raw.handlers}>
        {modeSwitch}
        {/*
         * A refusal belongs on the control that caused it, so it arrives as
         * the Field's invalid state — `aria-invalid` plus a `role="alert"`
         * message the textarea is described by — rather than as a detached
         * banner above it.
         */}
        <Field
          label="Validation JSON"
          help="The full validation and display config. Switch to Visual to parse these settings back into structured fields."
          {...raw.of("validation")}
        >
          {(control) => (
            <Textarea
              {...control}
              name="validation"
              class="pk-mono"
              rows={7}
              value={field.rawValidationText}
              placeholder="{}"
              onInput={(e) => updateField(index, { rawValidationText: (e.target as HTMLTextAreaElement).value })}
            />
          )}
        </Field>
      </div>
    );
  }

  // ── Visual mode ──────────────────────────────────────────────────────────────
  return (
    <div class="pk pk-stack pk-stack--snug" {...visual.handlers}>
      {modeSwitch}

      {/* Options textarea — choice fields only */}
      {c.options && (
        <Field label="Options" help="One per line.">
          {(control) => (
            <Textarea
              {...control}
              class="pk-mono"
              rows={5}
              value={field.optionsText}
              placeholder={"Option A\nOption B"}
              onInput={(e) => updateField(index, { optionsText: (e.target as HTMLTextAreaElement).value })}
            />
          )}
        </Field>
      )}

      <div class="pk-grid pk-grid--tight">
        {/* Placeholder — not for choice / boolean */}
        {c.placeholder && (
          <Field label="Placeholder" {...visual.of("placeholder")}>
            {(control) => (
              <TextInput
                {...control}
                name="placeholder"
                value={field.placeholder}
                onInput={(e) => updateField(index, { placeholder: (e.target as HTMLInputElement).value })}
              />
            )}
          </Field>
        )}

        {/* Help text — always visible */}
        <Field label="Help text" {...visual.of("helpText")}>
          {(control) => (
            <TextInput
              {...control}
              name="helpText"
              value={field.helpText}
              onInput={(e) => updateField(index, { helpText: (e.target as HTMLInputElement).value })}
            />
          )}
        </Field>

        {/* Stats view — always visible */}
        <Field label="Stats view" {...visual.of("adminVisualization")}>
          {(control) => (
            <Select
              {...control}
              name="adminVisualization"
              value={field.adminVisualization}
              onChange={(e) =>
                updateField(index, {
                  adminVisualization: (e.target as HTMLSelectElement).value as VisualizationConfig,
                })
              }
            >
              {VIZ_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* Length limits — text / textarea / email / url */}
        {c.lengthLimits && (
          <>
            <Field label="Min length" {...visual.of("minLength")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="minLength"
                  type="number"
                  min="0"
                  value={field.minLength}
                  onInput={(e) => updateField(index, { minLength: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Max length" {...visual.of("maxLength")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="maxLength"
                  type="number"
                  min="0"
                  value={field.maxLength}
                  onInput={(e) => updateField(index, { maxLength: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Numeric range — number / date */}
        {c.numericRange && (
          <>
            <Field label="Min" {...visual.of("min")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="min"
                  type="number"
                  value={field.min}
                  onInput={(e) => updateField(index, { min: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Max" {...visual.of("max")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="max"
                  type="number"
                  value={field.max}
                  onInput={(e) => updateField(index, { max: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Step — number only */}
        {c.step && (
          <Field label="Step" {...visual.of("step")}>
            {(control) => (
              <TextInput
                {...control}
                name="step"
                type="number"
                value={field.step}
                onInput={(e) => updateField(index, { step: (e.target as HTMLInputElement).value })}
              />
            )}
          </Field>
        )}

        {/* Selection range — multi_select only */}
        {c.selectionLimits && (
          <>
            <Field label="Min selections" {...visual.of("minItems")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="minItems"
                  type="number"
                  min="0"
                  value={field.minItems}
                  onInput={(e) => updateField(index, { minItems: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Max selections" {...visual.of("maxItems")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="maxItems"
                  type="number"
                  min="0"
                  value={field.maxItems}
                  onInput={(e) => updateField(index, { maxItems: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Regex pattern + error message — text only */}
        {c.pattern && (
          <>
            <Field label="Pattern" help="A regular expression." {...visual.of("pattern")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="pattern"
                  class="pk-mono"
                  value={field.pattern}
                  onInput={(e) => updateField(index, { pattern: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
            <Field label="Pattern error message" {...visual.of("patternMessage")}>
              {(control) => (
                <TextInput
                  {...control}
                  name="patternMessage"
                  value={field.patternMessage}
                  onInput={(e) => updateField(index, { patternMessage: (e.target as HTMLInputElement).value })}
                />
              )}
            </Field>
          </>
        )}

        {/* Widget */}
        <Field label="Widget" {...visual.of("uiWidget")}>
          {(control) => (
            <Select
              {...control}
              name="uiWidget"
              value={field.uiWidget}
              onChange={(e) => updateField(index, { uiWidget: (e.target as HTMLSelectElement).value })}
            >
              {UI_WIDGETS.map((w) => (
                <option key={w || "none"} value={w}>
                  {w ? w.replace(/_/g, " ") : "Default"}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {/* Format — text-like / choice fields */}
        {c.format && (
          <Field label="Format" {...visual.of("format")}>
            {(control) => (
              <Select
                {...control}
                name="format"
                value={field.format}
                onChange={(e) => updateField(index, { format: (e.target as HTMLSelectElement).value })}
              >
                {FIELD_FORMATS.map((f) => (
                  <option key={f || "none"} value={f}>
                    {f ? f.replace(/_/g, " ") : "Default"}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      {/* Allow custom answers — select / multi_select. The design system's
          checkbox wraps its own label, so the association survives without an
          id the surrounding list has to keep unique per field. */}
      {c.allowCustom && (
        <Checkbox
          label="Allow custom answers"
          name="allowCustom"
          checked={field.allowCustom}
          onChange={(e) => updateField(index, { allowCustom: (e.target as HTMLInputElement).checked })}
        />
      )}

      {/* Allowed email domains — email only */}
      {c.allowedDomains && (
        <Field label="Allowed domains" help="One per line." {...visual.of("allowedDomains")}>
          {(control) => (
            <Textarea
              {...control}
              name="allowedDomains"
              class="pk-mono"
              rows={2}
              value={field.allowedDomainsText}
              placeholder="example.com"
              onInput={(e) =>
                updateField(index, {
                  allowedDomainsText: (e.target as HTMLTextAreaElement).value,
                })
              }
            />
          )}
        </Field>
      )}
    </div>
  );
}
