/**
 * Printed attendee text never breaks inside a word. The renderer measures each attendee field per badge and
 * exposes the counts as custom properties on the badge root; templates size the text from them with
 * `badgeTextFitFontSize`, so the longest word always fits its column and lines break only between words.
 */
export const BADGE_TEXT_FIT_FIELDS = {
  firstName: "first-name",
  lastName: "last-name",
  displayName: "display-name",
  organization: "organization",
  jobTitle: "job-title",
} as const;
export type BadgeTextFitField = keyof typeof BADGE_TEXT_FIT_FIELDS;

const characters = (value: string) => [...value].length;

/** `--badge-<field>-longest` (longest word) and `--badge-<field>-length` (whole value), each at least 1. */
export function badgeTextFitProperties(values: Readonly<Record<BadgeTextFitField, string>>): string {
  return (Object.keys(BADGE_TEXT_FIT_FIELDS) as BadgeTextFitField[])
    .map((field) => {
      const value = values[field].trim();
      const longest = Math.max(1, ...value.split(/\s+/).map(characters));
      const name = BADGE_TEXT_FIT_FIELDS[field];
      return `--badge-${name}-longest:${Math.min(longest, 200)};--badge-${name}-length:${Math.max(1, Math.min(characters(value), 400))}`;
    })
    .join(";");
}

/** Typical advance of one character as a fraction of the font size; generous so real names fit. */
export const BADGE_TEXT_FIT_CHARACTER_EM = { bold: 0.62, regular: 0.56 } as const;

/**
 * A font size that keeps the field's longest word within `widthMm`, between `minMm` and `maxMm`. While the whole
 * value can stay on one line at no less than `oneLineFloor` of the maximum, it shrinks to do so; beyond that it
 * wraps between words instead of shrinking further.
 */
export function badgeTextFitFontSize(input: {
  field: BadgeTextFitField;
  widthMm: number;
  maxMm: number;
  minMm: number;
  weight: keyof typeof BADGE_TEXT_FIT_CHARACTER_EM;
  oneLineFloor?: number;
  /** Lines the whole value may take before the floor applies; one by default. */
  lines?: number;
}): string {
  const name = BADGE_TEXT_FIT_FIELDS[input.field];
  const em = BADGE_TEXT_FIT_CHARACTER_EM[input.weight];
  const word = `calc(${input.widthMm}mm / (var(--badge-${name}-longest,1) * ${em}))`;
  const line = `calc(${input.widthMm * (input.lines ?? 1)}mm / (var(--badge-${name}-length,1) * ${em}))`;
  const floor = `${Math.round(input.maxMm * (input.oneLineFloor ?? 0.75) * 1000) / 1000}mm`;
  return `max(${input.minMm}mm,min(${input.maxMm}mm,${word},max(${floor},${line})))`;
}

/** Lines break only between words; a word is never split or hyphenated. */
export const BADGE_TEXT_FIT_WRAPPING = "overflow-wrap:normal;word-break:normal;hyphens:manual";
