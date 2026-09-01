import { useCallback, useEffect, useId, useRef, useState } from "preact/hooks";
import {
  buildCollectionResetKey,
  useCollectionResetPending,
  useServerCollection,
  type CollectionLoader,
} from "../hooks/useServerCollection";
import { getJson } from "../shared/api-client";
import type { ServerCatalog } from "../shared/server-catalog";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { Select, TextInput } from "../ui/TextControl";

const SELECTOR_PAGE_SIZE = 25;
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

/** Shared paginated selector; filtering, sorting, and paging stay on the server. */
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
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const selectId = useId();
  const valueRef = useRef(value);
  valueRef.current = value;
  const excluded = new Set(excludeValues);
  const resetKey = buildCollectionResetKey(catalog.endpoint, catalog.params);
  const resetOffset = useCallback(() => setOffset(0), []);
  const resetPending = useCollectionResetPending(resetKey, resetOffset);

  useEffect(() => {
    setPendingSearch("");
    setSearch("");
  }, [resetKey]);

  const collection = useServerCollection({
    endpoint: catalog.endpoint,
    params: {
      ...catalog.params,
      limit: String(SELECTOR_PAGE_SIZE),
      offset: String(resetPending ? 0 : offset),
      sort: catalog.sort,
      ...(!resetPending && search ? { q: search } : {}),
    },
    responseSchema: catalog.responseSchema,
    load,
  });
  const page = collection.data ? catalog.resolvePage(collection.data) : null;
  const rawItems = collection.data ? catalog.resolveItems(collection.data) : [];
  const items = rawItems.filter((item) => !excluded.has(catalog.itemKey(item)));
  const hasSelectedOption = items.some((item) => catalog.itemKey(item) === value);

  useEffect(() => {
    if (!valueRef.current && autoSelectFirst && items[0]) {
      const first = items[0];
      valueRef.current = catalog.itemKey(first);
      onChange(first);
    }
  }, [autoSelectFirst, items, onChange, catalog]);

  function applySearch(): void {
    setOffset(0);
    setSearch(pendingSearch.trim());
  }

  return (
    <div class="pk-stack pk-stack--tight">
      {/* The visible name now points at the control it names. It used to be a
          bare `<label>` with no `for`, while the select carried a duplicate
          copy of the same word in `aria-label`. */}
      <label class="pk-field__label" for={selectId}>
        {label}
      </label>
      {/* One flex row, the way the Bootstrap input group was: `pk-input`'s
          `min-width: 0` lets the search field absorb the shrinking so the
          button keeps its text on one line. */}
      <div class="pk-field__control">
        <TextInput
          type="search"
          aria-label={`${label} search`}
          placeholder={searchPlaceholder ?? `Search ${label.toLowerCase()}…`}
          value={pendingSearch}
          disabled={disabled}
          onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applySearch();
            }
          }}
        />
        <Button size="sm" disabled={disabled} onClick={applySearch}>
          Search
        </Button>
      </div>
      <Select
        id={selectId}
        value={value ?? ""}
        disabled={disabled || collection.loading}
        onChange={(event) => {
          const next = (event.target as HTMLSelectElement).value;
          const selected = items.find((item) => catalog.itemKey(item) === next) ?? null;
          valueRef.current = selected ? catalog.itemKey(selected) : null;
          onChange(selected);
        }}
      >
        {allowEmpty && <option value="">{placeholder}</option>}
        {value && !hasSelectedOption && <option value={value}>{selectedLabel ?? value}</option>}
        {items.map((item) => (
          <option key={catalog.itemKey(item)} value={catalog.itemKey(item)}>
            {catalog.itemLabel(item)}
          </option>
        ))}
      </Select>
      <div class="pk-cluster">
        {/* The count and a failed load used to be the same sentence in two
            colours, which is a status nobody who cannot separate red from grey
            can read. A failure is now its own block, with its own role. */}
        <span class="pk-small" aria-live="polite">
          {collection.loading
            ? "Loading…"
            : page && page.total > 0
              ? `${page.offset + 1}–${page.offset + rawItems.length} of ${page.total}`
              : "No matches"}
        </span>
        <div class="pk-cluster pk-push" role="group" aria-label={`${label} result pages`}>
          <Button
            size="sm"
            disabled={disabled || collection.loading || offset === 0}
            onClick={() => setOffset((current) => Math.max(0, current - SELECTOR_PAGE_SIZE))}
          >
            Previous
          </Button>
          <Button
            size="sm"
            disabled={disabled || collection.loading || !page?.hasMore}
            onClick={() => setOffset((current) => current + SELECTOR_PAGE_SIZE)}
          >
            Next
          </Button>
        </div>
      </div>
      {collection.error && <Alert tone="danger">{collection.error.message}</Alert>}
    </div>
  );
}
