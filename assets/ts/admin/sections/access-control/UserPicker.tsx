import { useRef, useState } from "preact/hooks";
import { api } from "../../api";
import type { AdminUser } from "../../types";

export interface PickedUser {
  id: string;
  email: string;
}

/** Debounced email/name search against GET /api/v1/admin/users, for picking a user to grant/assign against. */
export function UserPicker({
  value,
  onChange,
  disabled,
  placeholder = "Search by email or name…",
}: {
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  disabled?: boolean;
  placeholder?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AdminUser[]>([]);
  const [open, setOpen] = useState(false);
  const timerRef = useRef<number | null>(null);

  function handleInput(next: string) {
    setQuery(next);
    if (value) onChange(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    const term = next.trim();
    if (!term) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = window.setTimeout(async () => {
      try {
        const data = await api<{ users: AdminUser[] }>(`/api/v1/admin/users?limit=8&q=${encodeURIComponent(term)}`);
        setResults(data.users);
        setOpen(true);
      } catch {
        setResults([]);
      }
    }, 250);
  }

  function pick(user: AdminUser) {
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
        onInput={(e) => handleInput((e.target as HTMLInputElement).value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        disabled={disabled}
      />
      {open && results.length > 0 && (
        <div
          class="list-group position-absolute w-100 shadow-sm"
          style={{ zIndex: 20, maxHeight: "220px", overflowY: "auto" }}
        >
          {results.map((user) => (
            <button
              key={user.id}
              type="button"
              class="list-group-item list-group-item-action py-1 px-2 small text-start"
              onMouseDown={(e) => e.preventDefault()}
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
    </div>
  );
}
