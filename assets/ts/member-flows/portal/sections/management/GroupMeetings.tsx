import { useState } from "preact/hooks";
import {
  eventSeriesCreateSchema,
  eventSeriesListResponseSchema,
  eventSeriesResponseSchema,
  type EventSeries,
} from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Pager } from "../../../../components/Pager";
import { Spinner } from "../../../../components/Spinner";
import { useApiPage } from "../../../../hooks/useApiPage";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import { fmt } from "../../ui";

function localDateTimeValue(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function defaultStart(): string {
  const start = new Date();
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  start.setHours(15, 0, 0, 0);
  return localDateTimeValue(start);
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function MeetingSeriesCard({ groupId, series }: { groupId: string; series: EventSeries }) {
  const next = series.nextOccurrenceAt ?? series.startsAt;
  return (
    <div class="border rounded p-3 d-flex flex-wrap align-items-start justify-content-between gap-3">
      <div>
        <div class="d-flex flex-wrap align-items-center gap-2">
          <span class="fw-semibold">{series.eventName}</span>
          <span class="badge text-bg-secondary">{series.profileKey.replaceAll("_", " ")}</span>
          {!series.active && <span class="badge text-bg-warning">Inactive</span>}
        </div>
        <div class="small text-muted mt-1">
          Next: {fmt(next)} · {series.timezone} · {series.durationMinutes} minutes
        </div>
        {series.location && <div class="small text-muted">{series.location}</div>}
      </div>
      <a
        class="btn btn-sm btn-outline-secondary"
        href={`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series/${encodeURIComponent(series.id)}/calendar.ics`}
      >
        Download calendar
      </a>
    </div>
  );
}

function CreateMeetingSeries({ groupId, onCreated }: { groupId: string; onCreated: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState(defaultStart);
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const [recurrenceRule, setRecurrenceRule] = useState("FREQ=WEEKLY;INTERVAL=1");
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [location, setLocation] = useState("");
  const [registrationPolicy, setRegistrationPolicy] = useState<"no_registration" | "optional" | "invitation_only">(
    "no_registration",
  );
  const [guestPolicy, setGuestPolicy] = useState<"none" | "occurrence_invitation">("occurrence_invitation");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = eventSeriesCreateSchema.parse({
        eventName: name,
        eventSlug: slugify(name),
        profileKey: "meeting",
        policy: {
          registrationPolicy,
          memberEligibility: "owner_group",
          guestPolicy,
        },
        startsAt: new Date(startsAt).toISOString(),
        recurrenceRule,
        timezone,
        durationMinutes,
        location: location.trim() || null,
        providerType: null,
      });
      await postJson(`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`, input, eventSeriesResponseSchema);
      setName("");
      setLocation("");
      await onCreated();
    } catch (cause) {
      setError(cause instanceof ApiClientError ? cause.message : "Could not create the meeting series.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="border rounded p-3 d-flex flex-column gap-3" onSubmit={submit}>
      <div>
        <h6 class="mb-1">Schedule a recurring meeting</h6>
        <p class="text-muted small mb-0">
          Group members can access the generated calendar. Registration is optional by policy; external guests can be
          restricted to individual invitations.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      <div class="row g-3">
        <div class="col-md-6">
          <label class="form-label small fw-semibold" for="managed-group-meeting-name">
            Meeting name
          </label>
          <input
            id="managed-group-meeting-name"
            class="form-control"
            value={name}
            required
            disabled={saving}
            onInput={(event) => setName((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold" for="managed-group-meeting-start">
            First occurrence
          </label>
          <input
            id="managed-group-meeting-start"
            type="datetime-local"
            class="form-control"
            value={startsAt}
            required
            disabled={saving}
            onInput={(event) => setStartsAt((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for="managed-group-meeting-recurrence">
            Recurrence
          </label>
          <select
            id="managed-group-meeting-recurrence"
            class="form-select"
            value={recurrenceRule}
            disabled={saving}
            onChange={(event) => setRecurrenceRule((event.target as HTMLSelectElement).value)}
          >
            <option value="FREQ=WEEKLY;INTERVAL=1">Weekly</option>
            <option value="FREQ=WEEKLY;INTERVAL=2">Every two weeks</option>
            <option value="FREQ=MONTHLY;INTERVAL=1">Monthly</option>
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for="managed-group-meeting-registration">
            Member registration
          </label>
          <select
            id="managed-group-meeting-registration"
            class="form-select"
            value={registrationPolicy}
            disabled={saving}
            onChange={(event) =>
              setRegistrationPolicy(
                (event.target as HTMLSelectElement).value as "no_registration" | "optional" | "invitation_only",
              )
            }
          >
            <option value="no_registration">No registration</option>
            <option value="optional">Optional registration</option>
            <option value="invitation_only">Invitation only</option>
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for="managed-group-meeting-guests">
            External guests
          </label>
          <select
            id="managed-group-meeting-guests"
            class="form-select"
            value={guestPolicy}
            disabled={saving}
            onChange={(event) =>
              setGuestPolicy((event.target as HTMLSelectElement).value as "none" | "occurrence_invitation")
            }
          >
            <option value="occurrence_invitation">Invite per occurrence</option>
            <option value="none">Not allowed</option>
          </select>
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for="managed-group-meeting-timezone">
            Time zone
          </label>
          <input
            id="managed-group-meeting-timezone"
            class="form-control"
            value={timezone}
            required
            readOnly
            aria-describedby="managed-group-meeting-timezone-help"
          />
          <div id="managed-group-meeting-timezone-help" class="form-text">
            Uses your browser time zone for the first occurrence.
          </div>
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for="managed-group-meeting-duration">
            Duration (minutes)
          </label>
          <input
            id="managed-group-meeting-duration"
            type="number"
            class="form-control"
            min="1"
            max="10080"
            value={durationMinutes}
            required
            disabled={saving}
            onInput={(event) => setDurationMinutes(Number((event.target as HTMLInputElement).value))}
          />
        </div>
        <div class="col-12">
          <label class="form-label small fw-semibold" for="managed-group-meeting-location">
            Location or public meeting page
          </label>
          <input
            id="managed-group-meeting-location"
            class="form-control"
            value={location}
            disabled={saving}
            onInput={(event) => setLocation((event.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div>
        <button type="submit" class="btn btn-primary" disabled={saving}>
          {saving ? "Creating…" : "Create meeting series"}
        </button>
      </div>
    </form>
  );
}

export function GroupMeetings({ groupId }: { groupId: string }) {
  const [pendingSearch, setPendingSearch] = useState("");
  const [search, setSearch] = useState("");
  const page = useApiPage(
    `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`,
    { active: "true", sort: "next_occurrence_at", ...(search ? { q: search } : {}) },
    eventSeriesListResponseSchema,
    (data) => data.series,
    25,
  );

  if (!page.data && page.loading) return <Spinner />;

  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Meetings</div>
      <div class="card-body d-flex flex-column gap-3">
        <form
          class="d-flex gap-2 portal-management-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(pendingSearch.trim());
          }}
        >
          <label class="visually-hidden" for="managed-group-meeting-search">
            Search meeting series
          </label>
          <input
            id="managed-group-meeting-search"
            type="search"
            class="form-control"
            placeholder="Search meeting name or location…"
            value={pendingSearch}
            onInput={(event) => setPendingSearch((event.target as HTMLInputElement).value)}
          />
          <button type="submit" class="btn btn-outline-secondary">
            Search
          </button>
        </form>
        {page.error && <ErrorAlert error={page.error.message} />}
        {page.data?.series.length === 0 ? (
          <p class="text-muted mb-0">No matching active meeting series.</p>
        ) : (
          <div class="d-flex flex-column gap-2">
            {page.data?.series.map((series) => (
              <MeetingSeriesCard key={series.id} groupId={groupId} series={series} />
            ))}
          </div>
        )}
        {page.pagerProps && <Pager {...page.pagerProps} />}
        <CreateMeetingSeries groupId={groupId} onCreated={page.reload} />
      </div>
    </div>
  );
}
