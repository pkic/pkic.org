import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { z } from "zod";
import { paginatedResponseSchema } from "../../shared/schemas/pagination";
import { userCatalogItemSchema } from "../../shared/schemas/user-catalog";
import { buildServerCollectionUrl, createLatestRequestGate } from "../hooks/useServerCollection";
import { getJson } from "../shared/api-client";
import { Alert } from "../ui/Alert";
import { TextInput } from "../ui/TextControl";
// The results float over whatever follows the picker, so they borrow the
// design system's popup surface rather than growing a second one. Nothing
// renders a `Menu` here, so the stylesheet has to be imported by name:
// component CSS ships in each component's own lazy chunk.
import "../ui/Menu.css";

/**
 * What the picker reads off a row, whichever list answers it. It is offered
 * the staff user list by default and the permissions catalog by some callers;
 * the two agree on a person's id, email and name, and only the catalog
 * carries the organization. Parsing with the catalog's full contract refused
 * every users-list reply — "Could not search users." on the organization
 * page's Link existing user form.
 */
const userPickerItemSchema = userCatalogItemSchema
  .pick({ id: true, email: true, first_name: true, last_name: true })
  .extend({ organization_name: z.string().nullable().optional() });
type UserCatalogItem = z.infer<typeof userPickerItemSchema>;
const userPickerListResponseSchema = paginatedResponseSchema("users", userPickerItemSchema);

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
  const anchorRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const requestGate = useRef<ReturnType<typeof createLatestRequestGate> | null>(null);
  requestGate.current ??= createLatestRequestGate();
  const showResults = open && results.length > 0;

  /*
   * The popup is `position: fixed` (see `ui/Menu.css`) so an ancestor with
   * `overflow: auto` — every scrollable table wrapper in the portal — cannot
   * clip it. Fixed means viewport coordinates, which no stylesheet can
   * express and which the repository forbids writing as a `style` attribute,
   * so the placement is applied imperatively here and refreshed as the page
   * moves underneath it. Re-placing rather than closing is deliberate: a
   * dropdown that closes on scroll is eaten by any trackpad twitch.
   */
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const popup = popupRef.current;
    if (!showResults || !anchor || !popup) return;

    const place = (): void => {
      const rect = anchor.getBoundingClientRect();
      popup.style.setProperty("top", `${rect.bottom + 4}px`);
      popup.style.setProperty("left", `${rect.left}px`);
      popup.style.setProperty("min-width", `${rect.width}px`);
    };

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [showResults, results]);

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
          userPickerListResponseSchema,
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
    <div class="pk-stack pk-stack--tight">
      <div ref={anchorRef}>
        <TextInput
          type="text"
          placeholder={placeholder}
          /* Every call site puts its own heading beside this control, but none
             of them can point a `for` at an id they do not own, so the field
             carried no accessible name at all. This one names it. */
          aria-label="Search for a user"
          value={value ? value.email : query}
          onInput={(event) => handleInput((event.target as HTMLInputElement).value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 150)}
          disabled={disabled}
          autocomplete="off"
          aria-autocomplete="list"
        />
      </div>
      {/*
       * Suggestions appear without the reader doing anything to ask for them,
       * so their arrival is announced rather than left to be discovered.
       *
       * Deliberately NOT the ARIA combobox pattern: that promises arrow-key
       * movement through a listbox and `aria-activedescendant`, and a control
       * that announces a keyboard contract it does not honour is worse than
       * one that announces none. The matches are ordinary buttons, next in
       * the tab order, which is a contract this does keep.
       */}
      <p class="pk-sr-only" role="status">
        {showResults ? `${results.length} matching ${results.length === 1 ? "user" : "users"}` : ""}
      </p>
      {showResults && (
        // Each match is a real <button>, so it is reachable by keyboard as
        // well as by pointer. `role="group"` is what lets the name land: a
        // bare `aria-label` on a <div> is discarded.
        <div ref={popupRef} class="pk-menu__popup" role="group" aria-label="Matching users">
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              class="pk-menu__item"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(user)}
            >
              <span class="pk-stack pk-stack--tight">
                <span class="pk-strong">{user.email}</span>
                <span class="pk-small">
                  {[user.first_name, user.last_name].filter(Boolean).join(" ") || "—"}
                  {user.organization_name ? ` · ${user.organization_name}` : ""}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
      {error && <Alert tone="danger">{error}</Alert>}
    </div>
  );
}
