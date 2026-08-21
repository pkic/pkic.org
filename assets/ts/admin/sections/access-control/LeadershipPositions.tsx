import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { ErrorAlert } from "../../../components/ErrorAlert";
import { Pager } from "../../../components/Pager";
import { useApiPage } from "../../../hooks/useApiPage";
import { api } from "../../api";
import { toast } from "../../ui";
import type { LeadershipPosition } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";
import {
  leadershipAffiliationsResponseSchema,
  leadershipPositionsListResponseSchema,
  type LeadershipAffiliation,
  type LeadershipPositionsListResponse,
} from "../../../../shared/schemas/leadership";

/** ISO date -> "1 Jun 2022" for display (starts_at/ends_at are date-only, no time component). */
function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function AffiliationPicker({
  userId,
  initialValue,
  value,
  onChange,
  disabled,
}: {
  userId: string | null;
  initialValue: string | null | undefined;
  value: string | null | undefined;
  onChange: (memberId: string | null | undefined) => void;
  disabled: boolean;
}) {
  const [affiliations, setAffiliations] = useState<LeadershipAffiliation[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAffiliations([]);
    if (!userId) {
      onChange(undefined);
      return;
    }

    setLoading(true);
    onChange(undefined);
    void api<unknown>(`/api/v1/admin/leadership-positions/users/${userId}/affiliations`)
      .then((raw) => leadershipAffiliationsResponseSchema.parse(raw).affiliations)
      .then((next) => {
        if (cancelled) return;
        setAffiliations(next);
        if (
          initialValue === null ||
          (initialValue !== undefined && next.some((item) => item.memberId === initialValue))
        ) {
          onChange(initialValue);
        } else if (next.length === 1) {
          onChange(next[0].memberId);
        } else if (next.length === 0) {
          onChange(null);
        }
      })
      .catch((error) => {
        if (!cancelled) toast((error as Error).message, "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, initialValue, onChange]);

  if (!userId) return null;

  return (
    <select
      class="form-select form-select-sm adm-leadership-affiliation"
      aria-label="Membership affiliation"
      value={value === undefined ? "" : (value ?? "none")}
      onChange={(event) => {
        const next = (event.target as HTMLSelectElement).value;
        onChange(next === "none" ? null : next || undefined);
      }}
      disabled={disabled || loading}
    >
      {value === undefined && <option value="">Select affiliation…</option>}
      <option value="none">No affiliation</option>
      {affiliations.map((affiliation) => (
        <option key={affiliation.memberId} value={affiliation.memberId}>
          {affiliation.organizationName ?? "Individual membership"} ({affiliation.membershipCategory})
        </option>
      ))}
    </select>
  );
}

function AddPositionForm({ onAdded, body }: { onAdded: () => void; body: "board" | "executive_council" }) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [memberId, setMemberId] = useState<string | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!picked || memberId === undefined || !title.trim() || !startsAt) return;
    setBusy(true);
    try {
      await api("/api/v1/admin/leadership-positions", {
        method: "POST",
        body: JSON.stringify({
          body,
          userId: picked.id,
          memberId,
          title: title.trim(),
          startsAt,
          endsAt: endsAt || null,
        }),
      });
      toast("Position added", "success");
      setPicked(null);
      setMemberId(undefined);
      setTitle("");
      setStartsAt("");
      setEndsAt("");
      onAdded();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} class="d-flex gap-2 align-items-center flex-wrap border rounded p-2 bg-light">
      <div class="adm-leadership-user">
        <UserPicker
          value={picked}
          onChange={(user) => {
            setPicked(user);
            setMemberId(undefined);
          }}
          disabled={busy}
        />
      </div>
      <AffiliationPicker
        userId={picked?.id ?? null}
        initialValue={undefined}
        value={memberId}
        onChange={setMemberId}
        disabled={busy}
      />
      <input
        class="form-control form-control-sm adm-leadership-title"
        type="text"
        placeholder="Title (e.g. Board Member)"
        value={title}
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        disabled={busy}
      />
      <input
        class="form-control form-control-sm adm-leadership-date"
        type="date"
        title="From"
        value={startsAt}
        onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
        disabled={busy}
      />
      <input
        class="form-control form-control-sm adm-leadership-date"
        type="date"
        title="Till (optional — leave blank for a current position)"
        placeholder="Till (optional)"
        value={endsAt}
        onInput={(e) => setEndsAt((e.target as HTMLInputElement).value)}
        disabled={busy}
      />
      <button
        type="submit"
        class="btn btn-sm btn-success"
        disabled={busy || !picked || memberId === undefined || !title.trim() || !startsAt}
      >
        Add
      </button>
    </form>
  );
}

function PositionRow({ position, onChanged }: { position: LeadershipPosition; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(position.title);
  const [memberId, setMemberId] = useState<string | null | undefined>(position.memberId);
  const [startsAt, setStartsAt] = useState(position.startsAt);
  const [endsAt, setEndsAt] = useState(position.endsAt ?? "");
  const [busy, setBusy] = useState(false);

  function startEdit() {
    setTitle(position.title);
    setMemberId(position.memberId);
    setStartsAt(position.startsAt);
    setEndsAt(position.endsAt ?? "");
    setEditing(true);
  }

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/api/v1/admin/leadership-positions/${position.id}`, {
        method: "PATCH",
        body: JSON.stringify({ memberId, title: title.trim(), startsAt, endsAt: endsAt || null }),
      });
      toast("Position updated", "success");
      setEditing(false);
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Remove ${position.name} (${position.title})?`)) return;
    setBusy(true);
    try {
      await api(`/api/v1/admin/leadership-positions/${position.id}`, { method: "DELETE" });
      toast("Position removed", "success");
      onChanged();
    } catch (err) {
      toast((err as Error).message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <form onSubmit={save} class="d-flex gap-2 align-items-center flex-wrap border rounded p-2">
        <span class="small fw-semibold adm-leadership-name">{position.name}</span>
        <AffiliationPicker
          userId={position.userId}
          initialValue={position.memberId}
          value={memberId}
          onChange={setMemberId}
          disabled={busy}
        />
        <input
          class="form-control form-control-sm adm-leadership-title"
          type="text"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          disabled={busy}
        />
        <input
          class="form-control form-control-sm adm-leadership-date"
          type="date"
          title="From"
          value={startsAt}
          onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
          disabled={busy}
        />
        <input
          class="form-control form-control-sm adm-leadership-date"
          type="date"
          title="Till (optional)"
          value={endsAt}
          onInput={(e) => setEndsAt((e.target as HTMLInputElement).value)}
          disabled={busy}
        />
        <button
          type="submit"
          class="btn btn-sm btn-success"
          disabled={busy || memberId === undefined || !title.trim() || !startsAt}
        >
          Save
        </button>
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div class="d-flex align-items-center gap-2 flex-wrap">
      <span class="adm-leadership-name">{position.name}</span>
      <span class="text-muted small">{position.title}</span>
      {position.organizationName && <span class="text-muted small">{position.organizationName}</span>}
      <span class="text-muted small">
        {fmtDate(position.startsAt)} – {position.endsAt ? fmtDate(position.endsAt) : "present"}
      </span>
      <button class="btn btn-sm btn-outline-secondary" disabled={busy} onClick={startEdit}>
        Edit
      </button>
      <button class="btn btn-sm btn-outline-danger" disabled={busy} onClick={() => void remove()}>
        Remove
      </button>
    </div>
  );
}

export function LeadershipPositions({ body, label }: { body: "board" | "executive_council"; label: string }) {
  const currentPage = useApiPage<LeadershipPositionsListResponse>(
    "/api/v1/admin/leadership-positions",
    {
      body,
      status: "current",
    },
    leadershipPositionsListResponseSchema,
    (data) => data.positions,
  );
  const pastPage = useApiPage<LeadershipPositionsListResponse>(
    "/api/v1/admin/leadership-positions",
    {
      body,
      status: "past",
    },
    leadershipPositionsListResponseSchema,
    (data) => data.positions,
  );
  const current = currentPage.data?.positions ?? [];
  const past = pastPage.data?.positions ?? [];
  const reload = () => Promise.all([currentPage.reload(), pastPage.reload()]);
  const loadError = currentPage.error ?? pastPage.error;

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">{label}</div>
      <div class="card-body d-flex flex-column gap-3">
        {loadError ? (
          <ErrorAlert error={loadError instanceof Error ? loadError : "Could not load leadership positions."} />
        ) : !currentPage.data || !pastPage.data ? (
          <Spinner />
        ) : (
          <>
            <div class="d-flex flex-column gap-2">
              {current.length === 0 && <span class="text-muted fst-italic small">No current members</span>}
              {current.map((p) => (
                <PositionRow key={p.id} position={p} onChanged={() => void reload()} />
              ))}
            </div>
            {currentPage.pagerProps && <Pager {...currentPage.pagerProps} />}
            <AddPositionForm body={body} onAdded={() => void reload()} />
            {past.length > 0 && (
              <div>
                <div class="small fw-semibold text-muted mb-2">Past positions</div>
                <div class="d-flex flex-column gap-2">
                  {past.map((p) => (
                    <PositionRow key={p.id} position={p} onChanged={() => void reload()} />
                  ))}
                </div>
                {pastPage.pagerProps && <Pager {...pastPage.pagerProps} />}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
