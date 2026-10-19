import { useState } from "preact/hooks";

import { useContractForm, type FieldPresentation } from "../../hooks/useContractForm";
import { FormChoicesEditor } from "./FormChoicesEditor";
import { Button } from "../../ui/Button";
import { Checkbox } from "../../ui/Checkbox";
import { Field } from "../../ui/Field";
import { FormFold } from "./FormFold";
import { Select, TextInput, Textarea } from "../../ui/TextControl";
import {
  FORM_FIELD_WIDGETS,
  formFieldRulesSchema,
  formFieldRulesTextSchema,
  VISUALIZATIONS,
  type Visualization,
} from "../../../shared/schemas/form-field-rules";
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

/**
 * What the author calls each presentation the rules schema accepts. The map is
 * total on that vocabulary, so a new presentation is a compile error here
 * rather than a choice this editor never offers.
 */
const VIZ_LABELS: Record<Visualization, string> = {
  auto: "Auto",
  bar: "Bar chart",
  pie: "Pie chart",
  donut: "Donut chart",
  wordcloud: "Word cloud",
  list: "Top list",
};

const VIZ_OPTIONS: Array<{ value: VisualizationConfig; label: string }> = VISUALIZATIONS.map((visualization) => ({
  value: visualization,
  label: VIZ_LABELS[visualization],
}));

const UI_WIDGETS = ["", ...FORM_FIELD_WIDGETS];

/**
 * What the closed "Accepted values" fold says about the rules inside it.
 *
 * Named rules come first because they are the ones an author is looking for;
 * a bare bound is reported as a range rather than as two separate numbers.
 */
function ruleSummary(field: FieldDraft, c: ReturnType<typeof caps>): string {
  const parts: string[] = [];
  if (c.pattern && field.pattern.trim()) parts.push("pattern");
  if (c.format && field.format) parts.push(field.format.replace(/_/g, " "));
  const low = c.lengthLimits ? field.minLength : field.min;
  const high = c.lengthLimits ? field.maxLength : field.max;
  const unit = c.lengthLimits ? " characters" : "";
  if (low && high) parts.push(`${low}–${high}${unit}`);
  else if (low) parts.push(`at least ${low}${unit}`);
  else if (high) parts.push(`up to ${high}${unit}`);
  if (c.selectionLimits && (field.minItems || field.maxItems)) parts.push("limited selections");
  if (c.allowedDomains && field.allowedDomainsText.trim()) parts.push("domain list");
  return parts.length ? parts.join(" · ") : "Anything the type allows";
}
const FIELD_FORMATS = ["", "iso_country", "phone", "professional_profile", "date_range"];

/** The rules behind the "Accepted values" fold. */
const RULE_NAMES = [
  "pattern",
  "patternMessage",
  "format",
  "minLength",
  "maxLength",
  "min",
  "max",
  "step",
  "minItems",
  "maxItems",
  "allowedDomains",
] as const;

// ── component ─────────────────────────────────────────────────────────────────

export function FieldConfigEditor({
  field,
  index,
  updateField,
  presentationOf,
}: {
  field: FieldDraft;
  index: number;
  updateField: (index: number, patch: Partial<FieldDraft>) => void;
  /**
   * The state of a part of this question in the contract of the form that
   * holds it — `options`, `key`, `validation.max` — so a refusal of the whole
   * form or poll shows on the control it is about.
   */
  presentationOf?: (path: string) => FieldPresentation;
}) {
  const c = caps(field.fieldType);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(false);
  // One contract, two representations: the visual controls are checked as
  // the rules they describe, the JSON editor as the text that has to parse
  // into those same rules. Either way the field rules contract the route
  // parses is what refuses a value, live, on the control it is about.
  const visual = useContractForm(formFieldRulesSchema, visualRules(field));
  const raw = useContractForm(formFieldRulesTextSchema, { validation: field.rawValidationText });
  // A rule refused by the enclosing contract speaks first; otherwise the rules contract's own verdict.
  const rule = (name: string): FieldPresentation => {
    const outer = presentationOf?.(`validation.${name}`);
    return outer?.message ? outer : visual.of(name);
  };
  const refused = (paths: readonly string[]) => paths.some((path) => Boolean(presentationOf?.(path)?.message));
  // A fold holding a refused control opens, so the refusal is never hidden behind it.
  const rulesShown = rulesOpen || refused(RULE_NAMES.map((name) => `validation.${name}`));
  const metaShown = metaOpen || refused(["key", "validation.uiWidget", "validation.adminVisualization"]);

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
          variant={field.rawMode ? "secondary" : "primary"}
          aria-pressed={field.rawMode ? "false" : "true"}
          onClick={() => {
            if (field.rawMode) toggleMode();
          }}
        >
          Visual
        </Button>
        <Button
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
          {...(presentationOf?.("validation")?.message ? presentationOf("validation") : raw.of("validation"))}
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
  /*
   * A fold stays closed until an author opens it, so its summary has to say
   * what is set inside. A fold that reads "Not restricted" is one they can
   * leave alone; one that names a rule is one they can check without opening.
   */
  const rulesSummary = ruleSummary(field, c);
  const metaSummary = field.key.trim() ? field.key.trim() : "No key yet";

  return (
    <div class="pk pk-stack pk-stack--snug" {...visual.handlers}>
      <Field label="Description" help="Respondents read this directly under the question." {...rule("helpText")}>
        {(control) => (
          <TextInput
            {...control}
            name="helpText"
            value={field.helpText}
            placeholder="Optional — one line of guidance"
            onInput={(e) => updateField(index, { helpText: (e.target as HTMLInputElement).value })}
          />
        )}
      </Field>

      {c.placeholder && (
        <Field
          label="Placeholder"
          help="Example text inside the empty box — it clears as soon as they type."
          {...rule("placeholder")}
        >
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

      {c.options && (
        <FormChoicesEditor
          field={field}
          update={(patch) => updateField(index, patch)}
          presentation={presentationOf?.("options")}
        />
      )}

      {c.allowCustom && (
        <Checkbox
          label="Offer an “Other…” option with a free-text box"
          name="allowCustom"
          checked={field.allowCustom}
          onChange={(e) => updateField(index, { allowCustom: (e.target as HTMLInputElement).checked })}
        />
      )}

      <FormFold
        title="Accepted values"
        summary={rulesSummary}
        open={rulesShown}
        onToggle={() => setRulesOpen((open) => !open)}
      >
        <div class="pk-grid pk-grid--tight">
          {c.pattern && (
            <>
              <Field label="Pattern" help="A regular expression." {...rule("pattern")}>
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
              <Field label="Message when it does not match" {...rule("patternMessage")}>
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

          {c.format && (
            <Field label="Format" {...rule("format")}>
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

          {c.lengthLimits && (
            <>
              <Field label="Min length" {...rule("minLength")}>
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
              <Field label="Max length" {...rule("maxLength")}>
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

          {c.numericRange && (
            <>
              <Field label="Min" {...rule("min")}>
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
              <Field label="Max" {...rule("max")}>
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

          {c.step && (
            <Field label="Step" {...rule("step")}>
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

          {c.selectionLimits && (
            <>
              <Field label="Min selections" {...rule("minItems")}>
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
              <Field label="Max selections" {...rule("maxItems")}>
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
        </div>

        {c.allowedDomains && (
          <Field label="Allowed domains" help="One per line." {...rule("allowedDomains")}>
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
      </FormFold>

      <FormFold
        title="Key and reporting"
        summary={metaSummary}
        open={metaShown}
        onToggle={() => setMetaOpen((open) => !open)}
      >
        <div class="pk-grid pk-grid--tight">
          <Field
            label="Field key"
            help="The name this answer carries in exports and the API."
            {...presentationOf?.("key")}
          >
            {(control) => (
              <TextInput
                {...control}
                class="pk-mono"
                value={field.key}
                required
                pattern="[a-z][a-z0-9_]*"
                placeholder="field_key"
                onInput={(e) => updateField(index, { key: (e.target as HTMLInputElement).value })}
              />
            )}
          </Field>

          <Field label="Widget" {...rule("uiWidget")}>
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

          <Field label="In the results summary" {...rule("adminVisualization")}>
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
        </div>

        {/*
         * The design puts a plain "edit as JSON" link here. This keeps the
         * two-button switch instead: `aria-pressed` is what tells assistive
         * technology which of the two editors is currently showing, and a
         * one-way link says nothing about the state it leaves behind.
         */}
        {modeSwitch}
      </FormFold>
    </div>
  );
}
