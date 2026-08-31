import { useRef, useState } from "preact/hooks";
import {
  eventOccurrenceGuestInviteSchema,
  eventOccurrenceGuestResponseSchema,
  eventOccurrenceGuestsListResponseSchema,
  type EventOccurrence,
  type EventOccurrenceGuest,
} from "../../../../../shared/schemas/event-series";
import type { EventInviteWindow } from "../../../../../shared/schemas/event-invite-validity";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { confirmAction } from "../../../../components/ConfirmDialog";
import { EmptyState } from "../../../../components/EmptyState";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { RowActions } from "../../../../ui/RowActions";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";
import { isoDateTimeValue, localDateTimeValue } from "./meeting-form-utils";

export function MeetingGuests({
  base,
  occurrence,
  seriesInviteWindow,
  timeZone,
}: {
  base: string;
  occurrence: EventOccurrence;
  seriesInviteWindow: EventInviteWindow;
  timeZone: string;
}) {
  const actions = useRef<ApiTableActions | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => localDateTimeValue(occurrence.startsAt, timeZone));
  const [seriesWide, setSeriesWide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `${base}/occurrences/${encodeURIComponent(occurrence.id)}/guests`;
  const effectiveWindow = seriesWide
    ? seriesInviteWindow
    : { startsAt: occurrence.startsAt, endsAt: occurrence.endsAt, timezone: timeZone };
  const maximumExpiry = effectiveWindow.endsAt ? localDateTimeValue(effectiveWindow.endsAt, timeZone) : undefined;

  async function invite(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const input = eventOccurrenceGuestInviteSchema.parse({
        email,
        name,
        affiliation: affiliation.trim() || null,
        expiresAt: isoDateTimeValue(expiresAt, timeZone),
        seriesWide,
      });
      await postJson(endpoint, input, eventOccurrenceGuestResponseSchema);
      setEmail("");
      setName("");
      setAffiliation("");
      toast("Guest eligibility added", "success");
      setShowAddForm(false);
      await actions.current?.reload();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(guest: EventOccurrenceGuest): Promise<void> {
    if (
      !(await confirmAction({
        title: `Revoke guest access for ${guest.name}?`,
        body: "This removes their eligibility for this occurrence and any active meeting access links.",
        consequences: [
          "Existing meeting access links for them stop working immediately",
          "They can be invited again later if needed",
        ],
        confirmLabel: "Revoke guest access",
      }))
    )
      return;
    try {
      await deleteJson(`${endpoint}/${encodeURIComponent(guest.id)}`, successResponseSchema);
      toast("Guest access revoked", "success");
      await actions.current?.reload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    }
  }

  return (
    <div class="d-flex flex-column gap-3">
      {showAddForm && (
        <form class="row g-2 border rounded p-3" onSubmit={(event) => void invite(event)}>
          <div class="col-12 d-flex justify-content-between align-items-start gap-2">
            <h6 class="mb-0">Add external guest eligibility</h6>
            <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setShowAddForm(false)}>
              Cancel
            </button>
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold" for={`meeting-guest-email-${occurrence.id}`}>
              Email
            </label>
            <input
              id={`meeting-guest-email-${occurrence.id}`}
              type="email"
              class="form-control form-control-sm"
              value={email}
              required
              onInput={(e) => setEmail(e.currentTarget.value)}
            />
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold" for={`meeting-guest-name-${occurrence.id}`}>
              Name
            </label>
            <input
              id={`meeting-guest-name-${occurrence.id}`}
              class="form-control form-control-sm"
              value={name}
              required
              onInput={(e) => setName(e.currentTarget.value)}
            />
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold" for={`meeting-guest-affiliation-${occurrence.id}`}>
              Affiliation
            </label>
            <input
              id={`meeting-guest-affiliation-${occurrence.id}`}
              class="form-control form-control-sm"
              value={affiliation}
              onInput={(e) => setAffiliation(e.currentTarget.value)}
            />
          </div>
          <div class="col-md-4">
            <label class="form-label small fw-semibold" for={`meeting-guest-expiry-${occurrence.id}`}>
              Eligibility expires
            </label>
            <input
              id={`meeting-guest-expiry-${occurrence.id}`}
              type="datetime-local"
              class="form-control form-control-sm"
              value={expiresAt}
              required
              max={maximumExpiry}
              onInput={(e) => setExpiresAt(e.currentTarget.value)}
            />
            <div class="form-text">
              Defaults to the {seriesWide ? "series event" : "occurrence"} start and cannot extend beyond its end.
            </div>
          </div>
          <div class="col-md-8 d-flex align-items-end">
            <div class="form-check mb-1">
              <input
                id={`guest-series-wide-${occurrence.id}`}
                type="checkbox"
                class="form-check-input"
                checked={seriesWide}
                onChange={(e) => {
                  const checked = e.currentTarget.checked;
                  setSeriesWide(checked);
                  const startsAt = checked ? seriesInviteWindow.startsAt : occurrence.startsAt;
                  if (startsAt) setExpiresAt(localDateTimeValue(startsAt, timeZone));
                }}
              />
              <label class="form-check-label" for={`guest-series-wide-${occurrence.id}`}>
                Eligible for every occurrence in this series
              </label>
            </div>
          </div>
          <div class="col-12 d-flex gap-2 align-items-center">
            <button type="submit" class="btn btn-sm btn-primary" disabled={saving}>
              {saving ? "Adding…" : "Add guest"}
            </button>
            {error && <ErrorAlert error={error} />}
          </div>
        </form>
      )}
      <ApiDataTable
        caption="External guests for this meeting occurrence"
        endpoint={endpoint}
        responseSchema={eventOccurrenceGuestsListResponseSchema}
        resolve={(response) => response.guests}
        resolvePage={(response) => response.page}
        paginate
        searchPlaceholder="Search guests…"
        initialSort="name"
        createAction={{ label: "Add guest", onSelect: () => setShowAddForm(true) }}
        actionsRef={actions}
        columns={[
          {
            header: "Guest",
            cell: (guest) => (
              <>
                <span class="fw-semibold">{guest.name}</span>
                <br />
                <span class="small text-muted">{guest.email}</span>
              </>
            ),
            sort: { asc: "name", desc: "-name" },
          },
          { header: "Affiliation", cell: (guest) => guest.affiliation ?? "—" },
          { header: "Scope", cell: (guest) => (guest.seriesWide ? "Series" : "Occurrence") },
          { header: "Expires", cell: (guest) => fmt(guest.expiresAt) },
          {
            header: "Status",
            cell: (guest) => (guest.revokedAt ? "Revoked" : guest.active ? "Active" : "Inactive"),
          },
          {
            header: "",
            className: "text-end",
            cell: (guest) =>
              !guest.active ? null : (
                <RowActions
                  label={`Actions for ${guest.name}`}
                  actions={[{ id: "revoke", label: "Revoke", onSelect: () => void revoke(guest) }]}
                />
              ),
          },
        ]}
        empty={<EmptyState title="No guests yet" body="Add a guest to get started." />}
        rowKey={(guest) => guest.id}
      />
    </div>
  );
}
