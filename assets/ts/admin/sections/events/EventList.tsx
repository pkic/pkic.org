import { useState, useRef } from "preact/hooks";
import { Badge } from "../../../components/Badge";
import { ApiDataTable, type ApiTableActions } from "../../../components/Table";
import { api } from "../../api";
import { toast } from "../../ui";
import type { EventSummary } from "../../types";
import { useHashLocation } from "wouter/use-hash-location";

// ────────────────────────────────────────────────────────
// New event form
// ────────────────────────────────────────────────────────

function NewEventForm({ onCreated, onCancel }: { onCreated: (slug: string) => void; onCancel: () => void }) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [mode, setMode] = useState("invite_or_open");
  const [inviteLimit, setInviteLimit] = useState(5);
  const [venue, setVenue] = useState("");
  const [virtualUrl, setVirtualUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  // auto-slug from name
  function handleNameChange(val: string) {
    setName(val);
    if (
      !slug ||
      slug ===
        name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
    ) {
      setSlug(
        val
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      );
    }
  }

  async function handleSubmit(e: Event) {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) {
      setStatus("Name and slug are required.");
      return;
    }
    setSaving(true);
    setStatus("Creating…");
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        slug: slug.trim(),
        timezone: timezone.trim() || "UTC",
        registration_mode: mode,
        invite_limit_attendee: inviteLimit,
      };
      if (startsAt) body.starts_at = new Date(startsAt).toISOString();
      if (endsAt) body.ends_at = new Date(endsAt).toISOString();
      if (venue.trim()) body.venue = venue.trim();
      if (virtualUrl.trim()) body.virtual_url = virtualUrl.trim();
      await api("/api/v1/admin/events", { method: "POST", body: JSON.stringify(body) });
      toast("Event created", "success");
      onCreated(slug.trim());
    } catch (e) {
      const msg = (e as Error).message;
      setStatus(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Event Name *</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={name}
            onInput={(e) => handleNameChange((e.target as HTMLInputElement).value)}
            placeholder="PKI Maturity Model Summit 2026"
            required
          />
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Slug *</label>
          <input
            class="form-control form-control-sm mono"
            type="text"
            value={slug}
            onInput={(e) => setSlug((e.target as HTMLInputElement).value)}
            placeholder="pki-summit-2026"
            pattern="[a-z0-9][a-z0-9-]*[a-z0-9]"
            required
          />
        </div>
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Start date</label>
          <input
            class="form-control form-control-sm"
            type="datetime-local"
            value={startsAt}
            onInput={(e) => setStartsAt((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">End date</label>
          <input
            class="form-control form-control-sm"
            type="datetime-local"
            value={endsAt}
            onInput={(e) => setEndsAt((e.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Timezone</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={timezone}
            onInput={(e) => setTimezone((e.target as HTMLInputElement).value)}
            placeholder="UTC"
            required
          />
        </div>
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Registration Mode</label>
          <select
            class="form-select form-select-sm"
            value={mode}
            onChange={(e) => setMode((e.target as HTMLSelectElement).value)}
          >
            <option value="invite_or_open">Invite or Open</option>
            <option value="invite_only">Invite Only</option>
            <option value="open">Open</option>
          </select>
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Invite Limit</label>
          <input
            class="form-control form-control-sm"
            type="number"
            value={inviteLimit}
            min={1}
            max={50}
            onInput={(e) => setInviteLimit(Number((e.target as HTMLInputElement).value))}
          />
        </div>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Venue</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={venue}
            onInput={(e) => setVenue((e.target as HTMLInputElement).value)}
            placeholder="Amsterdam, Netherlands"
          />
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Virtual URL</label>
          <input
            class="form-control form-control-sm"
            type="url"
            value={virtualUrl}
            onInput={(e) => setVirtualUrl((e.target as HTMLInputElement).value)}
            placeholder="https://..."
          />
        </div>
      </div>
      <div class="d-flex gap-2 align-items-center">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
          Create Event
        </button>
        <button type="button" class="btn btn-sm btn-secondary" onClick={onCancel}>
          Cancel
        </button>
        {status && <span class="small text-muted">{status}</span>}
      </div>
    </form>
  );
}

// ────────────────────────────────────────────────────────
// Event list
// ────────────────────────────────────────────────────────

export function EventList() {
  const [showNewForm, setShowNewForm] = useState(false);
  const [, navigate] = useHashLocation();
  const tableRef = useRef<ApiTableActions | null>(null);

  function handleCreated(slug: string) {
    setShowNewForm(false);
    tableRef.current?.reload();
    navigate(`/events/${encodeURIComponent(slug)}`);
  }

  return (
    <div>
      <div class="mb-3">
        <button class="btn btn-sm btn-success" onClick={() => setShowNewForm((v) => !v)}>
          {showNewForm ? "Cancel" : "+ New Event"}
        </button>
      </div>

      {showNewForm && (
        <div class="card border-0 shadow-sm mb-3">
          <div class="card-header bg-white fw-semibold">Create new event</div>
          <div class="card-body">
            <NewEventForm onCreated={handleCreated} onCancel={() => setShowNewForm(false)} />
          </div>
        </div>
      )}

      <ApiDataTable<EventSummary>
        endpoint="/api/v1/admin/events"
        resolve={(d) => (d as { events: EventSummary[] }).events}
        actionsRef={tableRef}
        columns={[
          {
            header: "Event",
            cell: (e) => (
              <>
                <strong class="adm-cell-name">{e.name}</strong>
                <br />
                <span class="mono text-muted small">{e.slug}</span>
              </>
            ),
          },
          {
            header: "Dates",
            cell: (e) => (e.starts_at ? e.starts_at.substring(0, 10) : "—"),
            className: "mono small text-nowrap",
          },
          { header: "Mode", cell: (e) => <Badge status={e.registration_mode} /> },
          {
            header: { label: "Confirmed", className: "text-end" },
            cell: (e) => e.confirmed_registrations ?? 0,
            className: "mono text-end",
          },
          {
            header: { label: "Total", className: "text-end" },
            cell: (e) => e.total_registrations ?? 0,
            className: "mono text-end",
          },
          {
            header: { label: "Pending", className: "text-end" },
            cell: (e) => e.pending_invites ?? 0,
            className: "mono text-end",
          },
          {
            header: "",
            cell: (e) => (
              <button
                class="btn btn-sm btn-outline-success"
                onClick={() => navigate(`/events/${encodeURIComponent(e.slug)}`)}
              >
                Manage →
              </button>
            ),
          },
        ]}
        empty="No events found"
        rowKey={(e) => e.slug}
      />
    </div>
  );
}
