import { Fragment, type ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { z } from "zod";
import { buildServerCollectionUrl, createLatestRequestGate } from "../hooks/useServerCollection";
import { getJson } from "../shared/api-client";
import { Alert } from "../ui/Alert";
import type { FieldControlProps } from "../ui/Field";
import { TextInput } from "../ui/TextControl";
import { usePopupPlacement } from "../ui/popup-placement";
// The results float over whatever follows the picker, so they borrow the
// design system's popup surface rather than growing a second one. Nothing
// renders a `Menu` here, so the stylesheet has to be imported by name:
// component CSS ships in each component's own lazy chunk.
import "../ui/Menu.css";

export interface SearchPickerProps<Data, Row> {
  /** What the field shows once something is picked; null while searching. */
  picked: string | null;
  onPick: (row: Row) => void;
  /** Called when the reader types again after picking, which lets the pick go. */
  onClear: () => void;
  endpoint: string;
  responseSchema: z.ZodType<Data>;
  /** The rows of one page of the server's answer. */
  rows: (data: Data) => Row[];
  rowKey: (row: Row) => string;
  /** One match as the popup shows it. */
  renderRow: (row: Row) => ComponentChildren;
  /** A match that is shown but cannot be picked, such as someone already added. */
  rowDisabled?: (row: Row) => boolean;
  /** Wraps a match's button, such as in a region that previews the match on hover. */
  decorateOption?: (row: Row, option: ComponentChildren) => ComponentChildren;
  /** The words the field keeps once a match is picked, until the caller's own `picked` takes over. */
  rowText: (row: Row) => string;
  /** How the screen reader counts matches: "user", "identity". */
  noun: [singular: string, plural: string];
  /** Names the field when no label points at it, e.g. "Search for a user". */
  label: string;
  /** Names the group of matches, e.g. "Matching users". */
  resultsLabel: string;
  sort?: string;
  disabled?: boolean;
  placeholder?: string;
  inputProps?: FieldControlProps & { name?: string };
  emptyMessage?: string;
  errorMessage?: string;
}

/**
 * Debounced, bounded server search that picks one row: the one search control
 * behind the user picker and every picker that searches a server list.
 */
export function SearchPicker<Data, Row>({
  picked,
  onPick,
  onClear,
  endpoint,
  responseSchema,
  rows,
  rowKey,
  renderRow,
  rowText,
  rowDisabled,
  decorateOption,
  noun,
  resultsLabel,
  label,
  sort = "name",
  disabled,
  placeholder,
  inputProps,
  emptyMessage = "No matches found.",
  errorMessage = "Could not search.",
}: SearchPickerProps<Data, Row>) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Row[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const requestGate = useRef<ReturnType<typeof createLatestRequestGate> | null>(null);
  requestGate.current ??= createLatestRequestGate();
  const showResults = open && results.length > 0;

  /*
   * The popup is `position: fixed` (see `ui/Menu.css`) so an ancestor with
   * `overflow: auto` cannot clip it, and the shared placement policy keeps it
   * in the viewport: below the field, flipped above it when there is no room
   * below, and clamped either way. A picker low on a page stays usable.
   */
  usePopupPlacement({ open: showResults, anchorRef, popupRef, revision: results.length, topLayer: true });

  function cancelPendingSearch(): void {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    requestGate.current?.cancel();
  }

  useEffect(() => cancelPendingSearch, []);
  const previousPicked = useRef(picked);
  useEffect(() => {
    if (previousPicked.current && !picked) setQuery("");
    previousPicked.current = picked;
  }, [picked]);

  function handleInput(next: string): void {
    setQuery(next);
    setError(null);
    if (picked) {
      previousPicked.current = null;
      onClear();
    }
    cancelPendingSearch();
    const term = next.trim();
    if (!term) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      timerRef.current = null;
      const request = requestGate.current!.start();
      try {
        const data = await getJson(
          buildServerCollectionUrl(endpoint, { limit: "8", offset: "0", sort, q: term }),
          responseSchema,
          { signal: request.signal },
        );
        if (!request.isCurrent()) return;
        setResults(rows(data));
        setOpen(true);
      } catch {
        if (!request.isCurrent()) return;
        setResults([]);
        setOpen(false);
        setError(errorMessage);
      }
    }, 250);
  }

  function pick(row: Row): void {
    cancelPendingSearch();
    setQuery(rowText(row));
    onPick(row);
    anchorRef.current?.querySelector("input")?.focus();
    setOpen(false);
    setResults([]);
  }

  return (
    <div
      class="pk-stack pk-stack--tight"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <div ref={anchorRef}>
        <TextInput
          {...inputProps}
          type="text"
          placeholder={placeholder}
          /* A caller that cannot point a label at this field still gets it named. */
          aria-label={inputProps?.id ? undefined : label}
          value={picked ?? query}
          onInput={(event) => handleInput((event.target as HTMLInputElement).value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          disabled={disabled}
          autocomplete="off"
          aria-autocomplete="list"
        />
      </div>
      {/*
       * Suggestions appear without the reader asking for them, so their
       * arrival is announced. Deliberately NOT the ARIA combobox pattern: the
       * matches are ordinary buttons, next in the tab order, a contract this
       * keeps, rather than an arrow-key listbox it would not honor.
       */}
      <p class="pk-sr-only" role="status">
        {showResults ? `${results.length} matching ${results.length === 1 ? noun[0] : noun[1]}` : ""}
      </p>
      {showResults && (
        <div ref={popupRef} class="pk-menu__popup" role="group" aria-label={resultsLabel}>
          {results.map((row) => {
            const option = (
              <button
                type="button"
                class="pk-menu__item"
                disabled={rowDisabled?.(row)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => pick(row)}
              >
                {renderRow(row)}
              </button>
            );
            return <Fragment key={rowKey(row)}>{decorateOption ? decorateOption(row, option) : option}</Fragment>;
          })}
        </div>
      )}
      {open && results.length === 0 && (
        <p class="pk-small" role="status">
          {emptyMessage}
        </p>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
