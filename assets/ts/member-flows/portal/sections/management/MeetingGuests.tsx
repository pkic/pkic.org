import { useRef, useState } from "preact/hooks";
import {
  eventOccurrenceGuestInviteSchema,
  eventOccurrenceGuestResponseSchema,
  eventOccurrenceGuestsListResponseSchema,
  type EventOccurrence,
} from "../../../../../shared/schemas/event-series";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import { ApiDataTable, type ApiTableActions } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { deleteJson, postJson } from "../../../../shared/api-client";
import { fmt, toast } from "../../ui";
import { defaultFutureDate, isoDateTimeValue } from "./meeting-form-utils";

export function MeetingGuests({
  base,
  occurrence,
  timeZone,
}: {
  base: string;
  occurrence: EventOccurrence;
  timeZone: string;
}) {
  const actions = useRef<ApiTableActions | null>(null);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [affiliation, setAffiliation] = useState("");
  const [expiresAt, setExpiresAt] = useState(() => defaultFutureDate(30, 23, 59, timeZone));
  const [seriesWide, setSeriesWide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const endpoint = `${base}/occurrences/${encodeURIComponent(occurrence.id)}/guests`;

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
      await actions.current?.reload();
    } catch (caught) {
      const message = (caught as Error).message;
      setError(message);
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function revoke(guestId: string): Promise<void> {
    if (!window.confirm("Revoke this guest and all active meeting access links?")) return;
    try {
      await deleteJson(`${endpoint}/${encodeURIComponent(guestId)}`, successResponseSchema);
      toast("Guest access revoked", "success");
      await actions.current?.reload();
    } catch (caught) {
      toast((caught as Error).message, "error");
    }
  }

  return (
    <div class="d-flex flex-column gap-3">
      <form class="row g-2 border rounded p-3" onSubmit={(event) => void invite(event)}>
        <div class="col-12">
          <h6 class="mb-0">Add external guest eligibility</h6>
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
            onInput={(e) => setExpiresAt(e.currentTarget.value)}
          />
        </div>
        <div class="col-md-8 d-flex align-items-end">
          <div class="form-check mb-1">
            <input
              id={`guest-series-wide-${occurrence.id}`}
              type="checkbox"
              class="form-check-input"
              checked={seriesWide}
              onChange={(e) => setSeriesWide(e.currentTarget.checked)}
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
      <ApiDataTable
        endpoint={endpoint}
        responseSchema={eventOccurrenceGuestsListResponseSchema}
        resolve={(response) => response.guests}
        resolvePage={(response) => response.page}
        paginate
        searchPlaceholder="Search guests…"
        initialSort="name"
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
            cell: (guest) =>
              guest.revokedAt ? "Revoked" : Date.parse(guest.expiresAt) <= Date.now() ? "Expired" : "Active",
          },
          {
            header: "",
            className: "text-end",
            cell: (guest) =>
              guest.revokedAt || Date.parse(guest.expiresAt) <= Date.now() ? null : (
                <button type="button" class="btn btn-sm btn-outline-danger" onClick={() => void revoke(guest.id)}>
                  Revoke
                </button>
              ),
          },
        ]}
        empty="No guests are eligible for this occurrence."
        rowKey={(guest) => guest.id}
      />
    </div>
  );
}
