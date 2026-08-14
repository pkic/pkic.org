import { useEffect, useState } from "preact/hooks";
import { Spinner } from "../../../components/Spinner";
import { api } from "../../api";
import { toast } from "../../ui";
import type { LeadershipPosition } from "../../types";
import { UserPicker, type PickedUser } from "./UserPicker";

/** ISO date -> "1 Jun 2022" for display (starts_at/ends_at are date-only, no time component). */
function fmtDate(value: string | null): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function AddPositionForm({ onAdded, body }: { onAdded: () => void; body: "board" | "executive_council" }) {
  const [picked, setPicked] = useState<PickedUser | null>(null);
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    if (!picked || !title.trim() || !startsAt) return;
    setBusy(true);
    try {
      await api("/api/v1/admin/leadership-positions", {
        method: "POST",
        body: JSON.stringify({
          body,
          userId: picked.id,
          title: title.trim(),
          startsAt,
          endsAt: endsAt || null,
        }),
      });
      toast("Position added", "success");
      setPicked(null);
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
      <div style={{ minWidth: "220px" }}>
        <UserPicker value={picked} onChange={setPicked} disabled={busy} />
      </div>
      <input
        class="form-control form-control-sm"
        style={{ width: "180px" }}
        type="text"
        placeholder="Title (e.g. Board Member)"
        value={title}
        onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
        disabled={busy}
      />
      <input
        class="form-control form-control-sm"
        style={{ width: "160px" }}
        type="date"
        title="From"
        value={startsAt}
        onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
        disabled={busy}
      />
      <input
        class="form-control form-control-sm"
        style={{ width: "160px" }}
        type="date"
        title="Till (optional — leave blank for a current position)"
        placeholder="Till (optional)"
        value={endsAt}
        onInput={(e) => setEndsAt((e.target as HTMLInputElement).value)}
        disabled={busy}
      />
      <button type="submit" class="btn btn-sm btn-success" disabled={busy || !picked || !title.trim() || !startsAt}>
        Add
      </button>
    </form>
  );
}

function PositionRow({ position, onChanged }: { position: LeadershipPosition; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(position.title);
  const [startsAt, setStartsAt] = useState(position.startsAt);
  const [endsAt, setEndsAt] = useState(position.endsAt ?? "");
  const [busy, setBusy] = useState(false);

  function startEdit() {
    setTitle(position.title);
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
        body: JSON.stringify({ title: title.trim(), startsAt, endsAt: endsAt || null }),
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
        <span class="small fw-semibold" style={{ minWidth: "160px" }}>
          {position.name}
        </span>
        <input
          class="form-control form-control-sm"
          style={{ width: "180px" }}
          type="text"
          value={title}
          onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
          disabled={busy}
        />
        <input
          class="form-control form-control-sm"
          style={{ width: "160px" }}
          type="date"
          title="From"
          value={startsAt}
          onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
          disabled={busy}
        />
        <input
          class="form-control form-control-sm"
          style={{ width: "160px" }}
          type="date"
          title="Till (optional)"
          value={endsAt}
          onInput={(e) => setEndsAt((e.target as HTMLInputElement).value)}
          disabled={busy}
        />
        <button type="submit" class="btn btn-sm btn-success" disabled={busy || !title.trim() || !startsAt}>
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
      <span style={{ minWidth: "160px" }}>{position.name}</span>
      <span class="text-muted small">{position.title}</span>
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
  const [positions, setPositions] = useState<LeadershipPosition[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const data = await api<{ positions: LeadershipPosition[] }>(`/api/v1/admin/leadership-positions?body=${body}`);
      setPositions(data.positions);
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [body]);

  const current = positions.filter((p) => !p.endsAt);
  const past = positions.filter((p) => p.endsAt);

  return (
    <div class="card border-0 shadow-sm mb-3">
      <div class="card-header bg-white fw-semibold">{label}</div>
      <div class="card-body d-flex flex-column gap-3">
        {loading ? (
          <Spinner />
        ) : (
          <>
            <div class="d-flex flex-column gap-2">
              {current.length === 0 && <span class="text-muted fst-italic small">No current members</span>}
              {current.map((p) => (
                <PositionRow key={p.id} position={p} onChanged={() => void load()} />
              ))}
            </div>
            <AddPositionForm body={body} onAdded={() => void load()} />
            {past.length > 0 && (
              <div>
                <div class="small fw-semibold text-muted mb-2">Past positions</div>
                <div class="d-flex flex-column gap-2">
                  {past.map((p) => (
                    <PositionRow key={p.id} position={p} onChanged={() => void load()} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
