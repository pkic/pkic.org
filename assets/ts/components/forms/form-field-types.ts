import { FORM_FIELD_TYPES, type FormFieldType } from "../../../shared/schemas/forms";

/**
 * How each answer type is presented and what an author may configure on it.
 *
 * The vocabulary itself is the shared contract's `FORM_FIELD_TYPES`; this adds
 * only the editor's view of them, in one place, so a card, the palette and the
 * respondent preview cannot disagree about what a type is called or offers.
 */
export interface FieldTypeProfile {
  /** What an author calls this answer type. */
  label: string;
  /** A monospace mark that reads as the shape of the answer. */
  glyph: string;
  /** Offered directly in the palette rather than behind "More types". */
  quick: boolean;
  /** Author-supplied choices, so the options editor applies. */
  options: boolean;
  /** Accepts more than one choice, which changes the option marker. */
  multiple: boolean;
  /** Example text can sit inside the empty control. */
  placeholder: boolean;
  /** A text shape can be constrained, so "Accepted values" applies. */
  pattern: boolean;
  /** Bounded by a count of characters rather than a numeric value. */
  lengthBounded: boolean;
}

const PROFILES: Record<FormFieldType, FieldTypeProfile> = {
  text: {
    label: "Short answer",
    glyph: "—",
    quick: true,
    options: false,
    multiple: false,
    placeholder: true,
    pattern: true,
    lengthBounded: true,
  },
  textarea: {
    label: "Paragraph",
    glyph: "¶",
    quick: true,
    options: false,
    multiple: false,
    placeholder: true,
    pattern: false,
    lengthBounded: true,
  },
  select: {
    label: "Dropdown",
    glyph: "▾",
    quick: true,
    options: true,
    multiple: false,
    placeholder: false,
    pattern: false,
    lengthBounded: false,
  },
  multi_select: {
    label: "Checkboxes",
    glyph: "☰",
    quick: true,
    options: true,
    multiple: true,
    placeholder: false,
    pattern: false,
    lengthBounded: false,
  },
  boolean: {
    label: "Yes or no",
    glyph: "☑",
    quick: true,
    options: false,
    multiple: false,
    placeholder: false,
    pattern: false,
    lengthBounded: false,
  },
  date: {
    label: "Date",
    glyph: "▦",
    quick: true,
    options: false,
    multiple: false,
    placeholder: false,
    pattern: false,
    lengthBounded: false,
  },
  email: {
    label: "Email",
    glyph: "@",
    quick: false,
    options: false,
    multiple: false,
    placeholder: true,
    pattern: true,
    lengthBounded: true,
  },
  url: {
    label: "URL",
    glyph: "↗",
    quick: false,
    options: false,
    multiple: false,
    placeholder: true,
    pattern: true,
    lengthBounded: true,
  },
  number: {
    label: "Number",
    glyph: "#",
    quick: false,
    options: false,
    multiple: false,
    placeholder: true,
    pattern: false,
    lengthBounded: false,
  },
};

export function fieldTypeProfile(type: FormFieldType): FieldTypeProfile {
  return PROFILES[type];
}

/** The types offered as one click in the palette, in the order shown. */
export const QUICK_FIELD_TYPES = FORM_FIELD_TYPES.filter((type) => PROFILES[type].quick);

/** The rest, offered behind the palette's "More types" menu. */
export const MORE_FIELD_TYPES = FORM_FIELD_TYPES.filter((type) => !PROFILES[type].quick);

/**
 * The one line a closed card shows under its label.
 *
 * It answers what an author scans a closed list for: whether the question is
 * answered from a list they wrote, and how long the list is.
 */
export function fieldSummary(field: {
  fieldType: FormFieldType;
  optionsText: string;
  optionSource?: string;
  helpText: string;
  required: boolean;
}): string {
  const profile = PROFILES[field.fieldType];
  const parts: string[] = [];
  if (field.optionSource) {
    parts.push("choices from the directory");
  } else if (profile.options) {
    const count = field.optionsText.split(/\n/).filter((line) => line.trim()).length;
    parts.push(count === 1 ? "1 choice" : `${String(count)} choices`);
  }
  if (field.required) parts.push("required");
  if (field.helpText.trim()) parts.push(field.helpText.trim());
  return parts.length ? parts.join(" · ") : "No description";
}
