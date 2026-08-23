import { useEffect, useRef, useState } from "preact/hooks";
import type { AdminCatalog } from "../services/catalogs";
import { loadAdminCollection } from "../services/server-collection";
import { useServerCollection } from "../../hooks/useServerCollection";

const SELECTOR_PAGE_SIZE = 25;

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
}: {
  catalog: AdminCatalog<Item, Response>;
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
}) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const excluded = new Set(excludeValues);
  const stableParams = JSON.stringify(
    Object.entries(catalog.params ?? {}).sort(([left], [right]) => left.localeCompare(right)),
  );

  useEffect(() => {
    setPendingSearch("");
    setSearch("");
    setOffset(0);
  }, [catalog.endpoint, stableParams]);

  const collection = useServerCollection({
    endpoint: catalog.endpoint,
    params: {
      ...catalog.params,
      limit: String(SELECTOR_PAGE_SIZE),
      offset: String(offset),
      sort: catalog.sort,
      ...(search ? { q: search } : {}),
    },
    responseSchema: catalog.responseSchema,
    load: loadAdminCollection,
  });
  const page = collection.data ? catalog.resolvePage(collection.data) : null;
  const rawItems = collection.data ? catalog.resolveItems(collection.data) : [];
  const items = rawItems.filter((item) => !excluded.has(catalog.itemKey(item)));
  const hasSelectedOption = items.some((item) => catalog.itemKey(item) === value);

  useEffect(() => {
    // Read the current controlled value rather than the render that queued
    // this effect. A user can choose an option while the first page finishes
    // committing; the late auto-select must not overwrite that choice.
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
    <div>
      <label class="form-label small fw-semibold mb-1">{label}</label>
      <div class="input-group input-group-sm mb-1">
        <input
          type="search"
          class="form-control"
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
        <button type="button" class="btn btn-outline-secondary" disabled={disabled} onClick={applySearch}>
          Search
        </button>
      </div>
      <select
        class="form-select form-select-sm"
        aria-label={label}
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
      </select>
      <div class="d-flex align-items-center gap-2 mt-1" aria-live="polite">
        <span class={`small ${collection.error ? "text-danger" : "text-muted"}`}>
          {collection.loading
            ? "Loading…"
            : collection.error
              ? collection.error.message
              : page && page.total > 0
                ? `${page.offset + 1}–${page.offset + rawItems.length} of ${page.total}`
                : "No matches"}
        </span>
        <div class="btn-group btn-group-sm ms-auto" role="group" aria-label={`${label} result pages`}>
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled={disabled || collection.loading || offset === 0}
            onClick={() => setOffset((current) => Math.max(0, current - SELECTOR_PAGE_SIZE))}
          >
            Previous
          </button>
          <button
            type="button"
            class="btn btn-outline-secondary"
            disabled={disabled || collection.loading || !page?.hasMore}
            onClick={() => setOffset((current) => current + SELECTOR_PAGE_SIZE)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
