import { useState, useCallback, useEffect, useRef, useMemo } from "preact/hooks";
import type { FormField } from "../types";
import { optionsFor, readRules, type FieldRules } from "./custom-field-rules";
import { COUNTRIES } from "../countries";

// ── Validation helpers ────────────────────────────────────────────────────

const PROFESSIONAL_DOMAINS = [
  "linkedin.com",
  "www.linkedin.com",
  "xing.com",
  "www.xing.com",
  "x.com",
  "www.x.com",
  "twitter.com",
  "www.twitter.com",
  "github.com",
  "www.github.com",
  "gitlab.com",
  "www.gitlab.com",
];

function professionalUrlAllowed(value: string, allowedDomains: string[]): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return allowedDomains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

/** Attaches custom validity logic for phone / professional_profile / pattern formats. */
function useStringValidation(rules: FieldRules) {
  const ref = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!rules.format && !rules.pattern) return;
    if (rules.format === "iso_country") return;

    const validate = () => {
      const value = el.value.trim();
      if (value.length === 0) {
        el.setCustomValidity("");
        return;
      }
      if (rules.format === "phone" && !/^\+?[0-9()\-\s]{7,25}$/.test(value)) {
        el.setCustomValidity("Please provide a valid phone number.");
        return;
      }
      if (rules.format === "professional_profile") {
        const allowed = rules.allowedDomains?.length ? rules.allowedDomains : PROFESSIONAL_DOMAINS;
        if (!professionalUrlAllowed(value, allowed)) {
          el.setCustomValidity("Please provide a supported professional profile URL.");
          return;
        }
      }
      if (rules.pattern) {
        try {
          if (!new RegExp(rules.pattern).test(value)) {
            el.setCustomValidity(rules.patternMessage ?? "This value does not match the expected format.");
            return;
          }
        } catch {
          el.setCustomValidity("Validation pattern is not configured correctly.");
          return;
        }
      }
      el.setCustomValidity("");
    };

    el.addEventListener("input", validate);
    el.addEventListener("blur", validate);
    return () => {
      el.removeEventListener("input", validate);
      el.removeEventListener("blur", validate);
    };
  }, [rules.format, rules.pattern, rules.patternMessage, rules.allowedDomains]);

  return ref;
}

// ── Prop builder for common HTML attributes ───────────────────────────────

function commonInputProps(field: FormField, rules: FieldRules) {
  const props: Record<string, unknown> = {};
  if (rules.placeholder) props.placeholder = rules.placeholder;
  if (rules.minLength !== undefined) props.minLength = rules.minLength;
  if (rules.maxLength !== undefined) props.maxLength = rules.maxLength;
  if (rules.min !== undefined) props.min = rules.min;
  if (rules.max !== undefined) props.max = rules.max;
  if (rules.step !== undefined) props.step = rules.step;
  if (rules.pattern) {
    props.pattern = rules.pattern;
    if (rules.patternMessage) props.title = rules.patternMessage;
  }
  props.required = field.required;
  return props;
}

// ── Fisher-Yates shuffle ──────────────────────────────────────────────────

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ── Widget components ─────────────────────────────────────────────────────

function BooleanInput({ field }: { field: FormField; initialValue?: unknown }) {
  return <input type="checkbox" name={`custom.${field.key}`} class="form-check-input" id={`custom-${field.key}`} />;
}

function SelectInput({ field, rules }: { field: FormField; rules: FieldRules }) {
  const firstLabel = rules.placeholder?.trim() || "Please select";
  return (
    <select name={`custom.${field.key}`} class="form-select" id={`custom-${field.key}`} required={field.required}>
      <option value="">{firstLabel}</option>
      {optionsFor(field).map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function MultiSelectCheckboxes({ field }: { field: FormField }) {
  const options = optionsFor(field);
  return (
    <div class="event-flow-checkbox-group">
      {options.map((option, index) => (
        <div key={option.value} class="form-check mb-2">
          <input
            type="checkbox"
            class="form-check-input"
            name={`custom.${field.key}[]`}
            value={option.value}
            id={`custom-${field.key}-${index}`}
          />
          <label class="form-check-label" for={`custom-${field.key}-${index}`}>
            {option.label}
          </label>
        </div>
      ))}
    </div>
  );
}

function TagPicker({ field, rules, initialValue }: { field: FormField; rules: FieldRules; initialValue?: unknown }) {
  const options = optionsFor(field);
  const shuffledOptions = useMemo(() => shuffled(options), [options]);

  const initial = useMemo(() => {
    if (Array.isArray(initialValue)) return new Set(initialValue.map(String));
    return new Set<string>();
  }, [initialValue]);

  const [selected, setSelected] = useState<Set<string>>(initial);
  const [inputValue, setInputValue] = useState("");
  const textRef = useRef<HTMLInputElement>(null);

  const addValue = useCallback(
    (raw: string) => {
      const trimmed = raw.trim();
      if (!trimmed) return;

      if (rules.allowCustom !== true && options.length > 0 && !options.some((o) => o.value === trimmed)) {
        textRef.current?.setCustomValidity("Please select a value from the suggested list.");
        textRef.current?.reportValidity();
        return;
      }
      if (rules.maxItems !== undefined && selected.size >= rules.maxItems) {
        textRef.current?.setCustomValidity(`You can add at most ${rules.maxItems} topics.`);
        textRef.current?.reportValidity();
        return;
      }

      textRef.current?.setCustomValidity("");
      setSelected((prev) => new Set(prev).add(trimmed));
      setInputValue("");
    },
    [options, rules.allowCustom, rules.maxItems, selected.size],
  );

  const removeValue = useCallback((value: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(value);
      return next;
    });
    textRef.current?.focus();
  }, []);

  const toggleChip = useCallback(
    (value: string) => {
      if (selected.has(value)) {
        removeValue(value);
      } else {
        addValue(value);
      }
    },
    [selected, addValue, removeValue],
  );

  const datalistId = options.length > 0 ? `custom-${field.key}-options` : undefined;

  return (
    <div class="event-flow-tags">
      <input
        type="hidden"
        name={`custom.${field.key}`}
        data-custom-widget="tags"
        value={JSON.stringify(Array.from(selected))}
      />

      {options.length > 0 && (
        <datalist id={datalistId}>
          {options.map((o) => (
            <option key={o.value} value={o.value} />
          ))}
        </datalist>
      )}

      {/* Selected pills */}
      <div class="event-flow-tags-selected">
        {Array.from(selected).map((value) => (
          <span key={value} class="event-flow-tag-pill">
            <span>{value}</span>
            <button
              type="button"
              class="event-flow-tag-remove"
              aria-label={`Remove ${value}`}
              onClick={() => removeValue(value)}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="10"
                height="10"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z" />
              </svg>
            </button>
          </span>
        ))}
      </div>

      {/* Text input + Add button */}
      <div class="event-flow-tags-controls">
        <input
          ref={textRef}
          type="text"
          class="form-control"
          placeholder={rules.placeholder ?? "Type a topic and press Enter"}
          autocomplete="off"
          list={datalistId}
          value={inputValue}
          onInput={(e) => {
            setInputValue((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).setCustomValidity("");
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addValue(inputValue);
            }
          }}
        />
        <button type="button" class="btn btn-outline-secondary btn-sm" onClick={() => addValue(inputValue)}>
          Add
        </button>
      </div>

      {/* Suggestion chips (shuffled to avoid bias) */}
      {shuffledOptions.length > 0 && (
        <div class="event-flow-tags-suggestions">
          {shuffledOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              class={`event-flow-tag-chip${selected.has(option.value) ? " is-selected" : ""}`}
              data-tag-chip="1"
              data-value={option.value}
              aria-pressed={selected.has(option.value) ? "true" : "false"}
              onClick={() => toggleChip(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function RatingButtons({
  field,
  min,
  max,
  initialValue,
}: {
  field: FormField;
  min: number;
  max: number;
  initialValue?: unknown;
}) {
  const hiddenRef = useRef<HTMLInputElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const select = useCallback((v: number) => {
    if (hiddenRef.current) hiddenRef.current.value = String(v);
    const buttons = wrapperRef.current?.querySelectorAll<HTMLButtonElement>("button[data-value]");
    buttons?.forEach((btn) => {
      btn.classList.toggle("btn-primary", btn.dataset.value === String(v));
      btn.classList.toggle("btn-outline-secondary", btn.dataset.value !== String(v));
    });
  }, []);

  useEffect(() => {
    let initial: number | null = null;
    if (typeof initialValue === "number") initial = initialValue;
    else if (typeof initialValue === "string") {
      const n = Number(initialValue);
      if (Number.isFinite(n)) initial = n;
    }
    if (initial !== null) select(initial);
  }, [initialValue, select]);

  return (
    <div ref={wrapperRef} class="event-flow-rating d-flex flex-wrap gap-2">
      <input ref={hiddenRef} type="hidden" name={`custom.${field.key}`} data-custom-widget="rating" />
      {Array.from({ length: max - min + 1 }, (_, i) => {
        const v = min + i;
        return (
          <button
            key={v}
            type="button"
            class="btn btn-sm btn-outline-secondary"
            data-value={String(v)}
            onClick={() => select(v)}
          >
            {v}
          </button>
        );
      })}
    </div>
  );
}

function CountrySelect({ field, rules, geoHint }: { field: FormField; rules: FieldRules; geoHint?: string | null }) {
  const selectRef = useRef<HTMLSelectElement>(null);
  const [hintVisible, setHintVisible] = useState(false);
  const hintApplied = useRef(false);

  useEffect(() => {
    if (!geoHint || hintApplied.current) return;
    const select = selectRef.current;
    if (!select || select.value) return; // don't override an explicit user choice
    const code = geoHint.toUpperCase();
    const option = select.querySelector<HTMLOptionElement>(`option[value="${code}"]`);
    if (option) {
      select.value = option.value;
      setHintVisible(true);
      hintApplied.current = true;
    }
  }, [geoHint]);

  return (
    <div class="event-flow-country-wrapper" data-country-widget="1">
      <select
        ref={selectRef}
        name={`custom.${field.key}`}
        class="form-select"
        id={`custom-${field.key}`}
        required={field.required}
        onChange={() => setHintVisible(false)}
      >
        <option value="">{rules.placeholder ?? "Select your country"}</option>
        {COUNTRIES.map((c) => (
          <option key={c.value} value={c.value}>
            {c.label}
          </option>
        ))}
      </select>
      <div class="event-flow-country-hint form-text" hidden={!hintVisible} aria-live="polite">
        {hintVisible && "Detected from your network — change if needed"}
      </div>
    </div>
  );
}

function DateRangeInput({ field }: { field: FormField }) {
  return (
    <div class="row g-2">
      <div class="col-md-6">
        <input type="date" class="form-control" name={`custom.${field.key}.start`} required={field.required} />
      </div>
      <div class="col-md-6">
        <input type="date" class="form-control" name={`custom.${field.key}.end`} required={field.required} />
      </div>
    </div>
  );
}

function TextAreaInput({ field, rules }: { field: FormField; rules: FieldRules }) {
  const validationRef = useStringValidation(rules);
  return (
    <textarea
      ref={validationRef as preact.RefObject<HTMLTextAreaElement>}
      name={`custom.${field.key}`}
      rows={4}
      class="form-control"
      id={`custom-${field.key}`}
      {...commonInputProps(field, rules)}
    />
  );
}

function TextInput({ field, rules }: { field: FormField; rules: FieldRules }) {
  const validationRef = useStringValidation(rules);

  let type = "text";
  if (field.fieldType === "number") type = "number";
  else if (field.fieldType === "date") type = "date";
  else if (field.fieldType === "email") type = "email";
  else if (field.fieldType === "url") type = "url";
  else if (rules.format === "phone") type = "tel";

  return (
    <input
      ref={validationRef as preact.RefObject<HTMLInputElement>}
      type={type}
      name={`custom.${field.key}`}
      class="form-control"
      id={`custom-${field.key}`}
      {...commonInputProps(field, rules)}
    />
  );
}

// ── Main dispatcher component ─────────────────────────────────────────────

export interface CustomFieldInputProps {
  field: FormField;
  geoHint?: string | null;
  initialValue?: unknown;
}

export function CustomFieldInput({ field, geoHint, initialValue }: CustomFieldInputProps) {
  const rules = readRules(field);

  if (field.fieldType === "boolean") {
    return <BooleanInput field={field} />;
  }

  if (field.fieldType === "select") {
    return <SelectInput field={field} rules={rules} />;
  }

  if (field.fieldType === "multi_select") {
    if (rules.uiWidget === "checkboxes") {
      return <MultiSelectCheckboxes field={field} />;
    }
    return <TagPicker field={field} rules={rules} initialValue={initialValue} />;
  }

  if (rules.uiWidget === "rating_stars") {
    const min = Number.isFinite(rules.min) ? Number(rules.min) : 1;
    const max = Number.isFinite(rules.max) ? Number(rules.max) : 5;
    return <RatingButtons field={field} min={min} max={max} initialValue={initialValue} />;
  }

  if (rules.uiWidget === "nps") {
    return <RatingButtons field={field} min={0} max={10} initialValue={initialValue} />;
  }

  if (rules.format === "date_range") {
    return <DateRangeInput field={field} />;
  }

  if (rules.format === "iso_country") {
    return <CountrySelect field={field} rules={rules} geoHint={geoHint} />;
  }

  if (field.fieldType === "textarea") {
    return <TextAreaInput field={field} rules={rules} />;
  }

  return <TextInput field={field} rules={rules} />;
}
