import type { ComponentChildren } from "preact";
import { formatDateTime } from "../shared/ui";

/** Matches an ISO-8601 instant with an explicit offset, e.g. "2026-08-21T10:00:00.000Z". */
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;

/** "previous_status" / "previousStatus" → "Previous status". */
function humanizeKey(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isIsoInstant(value: string): boolean {
  return ISO_INSTANT_PATTERN.test(value);
}

/** Renders a single primitive (or null/undefined) as display text. */
function formatPrimitiveText(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string" && isIsoInstant(value)) return formatDateTime(value);
  return String(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** JSON structural depth: primitives are 0, an object/array adds one level for itself plus its deepest child. */
function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  if (children.length === 0) return 1;
  return 1 + Math.max(...children.map(jsonDepth));
}

function renderValue(value: unknown): ComponentChildren {
  if (isPlainObject(value)) {
    const nestedEntries = Object.entries(value);
    if (nestedEntries.length === 0) return "—";
    return (
      <dl class="details-summary-sublist mb-0">
        {nestedEntries.map(([key, nestedValue]) => (
          <div class="details-summary-row" key={key}>
            <dt>{humanizeKey(key)}</dt>
            <dd>{formatPrimitiveText(nestedValue)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    return value.map((item) => formatPrimitiveText(item)).join(", ");
  }
  return formatPrimitiveText(value);
}

function RawDetailsFallback({ value }: { value: unknown }) {
  return (
    <details class="details-summary-raw">
      <summary>Raw details</summary>
      <pre class="mb-0 small text-body-secondary">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

/**
 * Renders an unknown JSON value (typically an audit log's `details` blob) as a readable
 * definition list instead of a raw `<pre>{JSON.stringify(...)}</pre>` dump.
 *
 * Object roots up to two levels deep render as a `<dl>` with humanized keys. Anything shallower
 * or deeper than that shape — a non-object root, or nesting past one level — falls back to a
 * collapsed raw-JSON view so no data is ever lost. An empty object or a nullish value renders
 * nothing.
 */
export function DetailsSummary({ value }: { value: unknown }) {
  if (value === null || value === undefined) return null;
  if (!isPlainObject(value)) return <RawDetailsFallback value={value} />;

  const entries = Object.entries(value);
  if (entries.length === 0) return null;
  if (jsonDepth(value) > 2) return <RawDetailsFallback value={value} />;

  return (
    <dl class="details-summary mb-0">
      {entries.map(([key, entryValue]) => (
        <div class="details-summary-row" key={key}>
          <dt>{humanizeKey(key)}</dt>
          <dd>{renderValue(entryValue)}</dd>
        </div>
      ))}
    </dl>
  );
}
