import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  buildCollectionResetKey,
  useCollectionResetPending,
  useServerCollection,
  type CollectionLoader,
} from "../hooks/useServerCollection";
import { getJson } from "../shared/api-client";
import type { ServerCatalog } from "../shared/server-catalog";
import { Alert } from "../ui/Alert";
import { TextInput } from "../ui/TextControl";
import { applyPopupPosition, measurePopupPosition, type PopupPosition } from "../ui/popup-placement";
// The matches float over whatever follows the field, so they borrow the
// design system's popup surface rather than growing a second one. Nothing
// renders a `Menu` here, so the stylesheet has to be imported by name:
// component CSS ships in each component's own lazy chunk.
import "../ui/Menu.css";

const SELECTOR_PAGE_SIZE = 25;
/** Below this many characters a query is noise, so the full first page shows instead. */
const MINIMUM_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 300;
const loadCollection: CollectionLoader = (url, signal, schema) => getJson(url, schema, { signal });

export interface ServerSearchSelectProps<Item, Response> {
  catalog: ServerCatalog<Item, Response>;
  label: string;
  value: string | null;
  selectedLabel?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  allowEmpty?: boolean;
  autoSelectFirst?: boolean;
  excludeValues?: readonly string[];
  onChange: (item: Item | null) => void;
  load?: CollectionLoader;
}

/**
 * Shared type-ahead selector; filtering, sorting, and paging stay on the
 * server.
 *
 * The interaction is the WAI-ARIA combobox pattern, honoured rather than
 * approximated: one text input carries `role="combobox"` with
 * `aria-expanded`, `aria-controls`, and `aria-activedescendant`; the matches
 * are a named listbox of options that never take focus themselves. Typing
 * queries the server after a pause — there is no separate "Search" button to
 * find — ArrowDown/ArrowUp move through the matches, Enter selects, Escape
 * closes and restores the chosen value's label.
 *
 * A newer keystroke's request invalidates any slower earlier one through the
 * collection hook's latest-request gate, so a stale response can never
 * overwrite fresher matches.
 *
 * The popup follows `Menu`'s placement discipline: `position: fixed` so an
 * `overflow: auto` ancestor cannot clip it, flipped above the field when
 * below does not fit, clamped into the viewport horizontally, and re-placed
 * rather than closed as the page scrolls underneath it.
 */
export function ServerSearchSelect<Item, Response>({
  catalog,
  label,
  value,
  selectedLabel,
  placeholder = "Select…",
  searchPlaceholder,
  disabled = false,
  allowEmpty = true,
  autoSelectFirst = false,
  excludeValues = [],
  onChange,
  load = loadCollection,
}: ServerSearchSelectProps<Item, Response>) {
  // `query` is the reader's in-progress text; null means "not editing", where
  // the input shows the chosen value's label instead. `search` is the
  // debounced, length-gated term the server actually receives.
  const [query, setQuery] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [position, setPosition] = useState<PopupPosition | null>(null);
  const inputId = useId();
  const listboxId = useId();
  const valueRef = useRef(value);
  valueRef.current = value;
  // The label of whatever was picked here, so the closed input can read it
  // back even when the current server page no longer contains the item.
  const pickedRef = useRef<{ key: string; label: string } | null>(null);
  const debounceRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLElement | null)[]>([]);
  const excluded = new Set(excludeValues);
  const resetKey = buildCollectionResetKey(catalog.endpoint, catalog.params);

  const cancelDebounce = useCallback(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);
  useEffect(() => cancelDebounce, [cancelDebounce]);

  // A different catalog identity is a different conversation: the old term
  // must not filter the new collection, not even for the one render before
  // the reset effect lands — `resetPending` blanks it synchronously.
  const resetSelection = useCallback(() => {
    cancelDebounce();
    setQuery(null);
    setSearch("");
    setOpen(false);
    setActiveIndex(-1);
  }, [cancelDebounce]);
  const resetPending = useCollectionResetPending(resetKey, resetSelection);

  const collection = useServerCollection({
    endpoint: catalog.endpoint,
    params: {
      ...catalog.params,
      limit: String(SELECTOR_PAGE_SIZE),
      offset: "0",
      sort: catalog.sort,
      ...(!resetPending && search ? { q: search } : {}),
    },
    responseSchema: catalog.responseSchema,
    load,
  });
  const page = collection.data ? catalog.resolvePage(collection.data) : null;
  const rawItems = collection.data ? catalog.resolveItems(collection.data) : [];
  const items = rawItems.filter((item) => !excluded.has(catalog.itemKey(item)));
  // The pick-nothing option keeps the old empty `<option>`'s place: choosing
  // it is choosing the placeholder's meaning ("Top-level group", "No form").
  const optionCount = (allowEmpty ? 1 : 0) + items.length;
  const itemAt = (index: number): Item | null => (allowEmpty ? (index === 0 ? null : items[index - 1]) : items[index]);
  const optionId = (index: number): string => `${listboxId}-option-${index}`;

  useEffect(() => {
    if (!valueRef.current && autoSelectFirst && items[0]) {
      const first = items[0];
      valueRef.current = catalog.itemKey(first);
      pickedRef.current = { key: catalog.itemKey(first), label: catalog.itemLabel(first) };
      onChange(first);
    }
  }, [autoSelectFirst, items, onChange, catalog]);

  // A shrinking result set must not leave the highlight past the end.
  useEffect(() => {
    setActiveIndex((current) => (current >= optionCount ? optionCount - 1 : current));
  }, [optionCount]);

  /** One placement policy for every popup — see `ui/popup-placement.ts`. */
  const measure = useCallback((): PopupPosition | null => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!anchor || !popup) return null;
    return measurePopupPosition(anchor.getBoundingClientRect(), popup.getBoundingClientRect());
  }, []);

  // Why imperative rather than a style attribute: see popup-placement.ts.
  useLayoutEffect(() => {
    const popup = popupRef.current;
    if (!popup || !position) return;
    applyPopupPosition(popup, position);
  }, [position]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    setPosition(measure());
  }, [open, measure, optionCount, collection.loading]);

  // The highlight can sit past the listbox's scroll window; focus never
  // leaves the input, so the option is brought into view directly.
  useLayoutEffect(() => {
    if (!open || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    setQuery(null);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popupRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      close();
    };
    // A fixed popup does not move with its anchor, so it is re-placed as the
    // page moves. Closing instead would mean any scroll momentum eats the
    // list the moment it opens.
    const onReflow = () => setPosition(measure());

    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, close, measure]);

  function choose(index: number): void {
    const item = itemAt(index);
    valueRef.current = item ? catalog.itemKey(item) : null;
    pickedRef.current = item ? { key: catalog.itemKey(item), label: catalog.itemLabel(item) } : null;
    onChange(item);
    close();
  }

  function handleInput(next: string): void {
    setQuery(next);
    setOpen(true);
    setActiveIndex(-1);
    cancelDebounce();
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null;
      const term = next.trim();
      setSearch(term.length >= MINIMUM_QUERY_LENGTH ? term : "");
    }, SEARCH_DEBOUNCE_MS);
  }

  function handleKeyDown(event: KeyboardEvent): void {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(optionCount > 0 ? 0 : -1);
        } else if (optionCount > 0) {
          setActiveIndex((current) => (current + 1 + optionCount) % optionCount);
        }
        break;
      case "ArrowUp":
        event.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIndex(optionCount - 1);
        } else if (optionCount > 0) {
          setActiveIndex((current) => (current - 1 + optionCount) % optionCount);
        }
        break;
      case "Enter":
        if (!open) break;
        event.preventDefault();
        if (activeIndex >= 0 && activeIndex < optionCount) choose(activeIndex);
        else close();
        break;
      case "Escape":
        if (!open) break;
        event.preventDefault();
        close();
        break;
      case "Tab":
        if (open) close();
        break;
      default:
        break;
    }
  }

  const picked = pickedRef.current;
  const displayLabel = value ? (picked?.key === value ? picked.label : (selectedLabel ?? value)) : "";
  const status = collection.loading
    ? "Loading…"
    : collection.error
      ? "Could not load matches."
      : items.length === 0
        ? search
          ? `No matches for “${search}”.`
          : "No matches."
        : page?.hasMore
          ? `Showing ${rawItems.length} of ${page.total} matches. Keep typing to narrow the list.`
          : "";

  return (
    <div class="pk-stack pk-stack--tight">
      <div class="pk-field">
        <label class="pk-field__label" for={inputId}>
          {label}
        </label>
        <div class="pk-field__control" ref={anchorRef}>
          <TextInput
            id={inputId}
            type="text"
            role="combobox"
            autocomplete="off"
            aria-haspopup="listbox"
            aria-expanded={open ? "true" : "false"}
            aria-controls={open ? listboxId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
            placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
            value={query ?? displayLabel}
            disabled={disabled}
            onInput={(event) => handleInput((event.target as HTMLInputElement).value)}
            onKeyDown={handleKeyDown}
            onClick={() => !disabled && !open && setOpen(true)}
            onBlur={close}
          />
        </div>
      </div>
      {open && (
        // Pressing anywhere in the popup — an option, the scrollbar — must
        // not steal focus from the input, or the blur would close the list
        // under the pointer.
        <div ref={popupRef} class="pk-menu__popup" onMouseDown={(event) => event.preventDefault()}>
          <div id={listboxId} role="listbox" aria-label={label} class="pk-menu__options">
            {allowEmpty && (
              <div
                id={optionId(0)}
                ref={(element) => {
                  optionRefs.current[0] = element;
                }}
                role="option"
                aria-selected={!value ? "true" : "false"}
                data-key=""
                class={["pk-menu__item", activeIndex === 0 ? "pk-menu__item--active" : null].filter(Boolean).join(" ")}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(0)}
              >
                {placeholder}
              </div>
            )}
            {items.map((item, itemIndex) => {
              const index = (allowEmpty ? 1 : 0) + itemIndex;
              const key = catalog.itemKey(item);
              return (
                <div
                  key={key}
                  id={optionId(index)}
                  ref={(element) => {
                    optionRefs.current[index] = element;
                  }}
                  role="option"
                  aria-selected={key === value ? "true" : "false"}
                  data-key={key}
                  class={["pk-menu__item", activeIndex === index ? "pk-menu__item--active" : null]
                    .filter(Boolean)
                    .join(" ")}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                >
                  {catalog.itemLabel(item)}
                </div>
              );
            })}
          </div>
          {/* Empty and truncated result sets say so in words rather than
              leaving a silent, shorter list. */}
          {status && (
            <p class="pk-menu__status" role="status">
              {status}
            </p>
          )}
        </div>
      )}
      {collection.error && <Alert tone="danger">{collection.error.message}</Alert>}
    </div>
  );
}
