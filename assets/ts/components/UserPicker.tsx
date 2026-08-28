import { useEffect, useRef, useState } from "preact/hooks";
import { userCatalogListResponseSchema, type UserCatalogItem } from "../../shared/schemas/user-catalog";
import { buildServerCollectionUrl, createLatestRequestGate } from "../hooks/useServerCollection";
import { getJson } from "../shared/api-client";

export interface PickedUser {
  id: string;
  email: string;
}

/** Debounced, bounded server search for selecting an existing user. */
export function UserPicker({
  value,
  onChange,
  disabled,
  placeholder = "Search by email or name…",
  endpoint = "/api/v1/users",
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  disabled?: boolean;
  placeholder?: string;
  endpoint?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserCatalogItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const requestGate = useRef<ReturnType<typeof createLatestRequestGate> | null>(null);
  requestGate.current ??= createLatestRequestGate();

  function cancelPendingSearch(): void {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    requestGate.current?.cancel();
  }

  useEffect(() => cancelPendingSearch, []);

  function handleInput(next: string): void {
    setQuery(next);
    setError(null);
    if (value) onChange(null);
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
          buildServerCollectionUrl(endpoint, { limit: "8", offset: "0", sort: "email", q: term }),
          userCatalogListResponseSchema,
          { signal: request.signal },
        );
        if (!request.isCurrent()) return;
        setResults(data.users);
        setOpen(true);
      } catch {
        if (!request.isCurrent()) return;
        setResults([]);
        setOpen(false);
        setError("Could not search users.");
      }
    }, 250);
  }

  function pick(user: UserCatalogItem): void {
    cancelPendingSearch();
    onChange({ id: user.id, email: user.email });
    setQuery(user.email);
    setOpen(false);
    setResults([]);
  }

  return (
    <div class="position-relative">
      <input
        class="form-control form-control-sm"
        type="text"
        placeholder={placeholder}
        value={value ? value.email : query}
        onInput={(event) => handleInput((event.target as HTMLInputElement).value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
        autocomplete="off"
        aria-autocomplete="list"
      />
      {open && results.length > 0 && (
        <div class="list-group position-absolute w-100 shadow-sm portal-user-picker-results">
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              class="list-group-item list-group-item-action py-1 px-2 small text-start"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(user)}
            >
              <div class="fw-semibold">{user.email}</div>
              <div class="text-muted">
                {[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}
                {user.organization_name ? ` · ${user.organization_name}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
      {error && (
        <div class="small text-danger mt-1" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}
