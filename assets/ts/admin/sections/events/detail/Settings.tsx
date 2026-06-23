import { useState, useEffect, useCallback } from "preact/hooks";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Tabs } from "../../../../components/Tabs";
import { api } from "../../../api";
import { toast } from "../../../ui";
import type {
  EventDetail,
  AdminEventDay,
  AdminAttendanceOption,
  AdminEventTerm,
  AdminEventFormSummary,
} from "../../../types";
import { Team } from "./Team";

type FormLinkPurpose = "event_registration" | "proposal_submission";
type FormLinkMode = "unset" | "none" | "explicit";

// ─── General tab ────────────────────────────────────────────────────────────

function toLocalDt(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 16);
  } catch {
    return "";
  }
}

function formLinkValue(settings: Record<string, unknown>, purpose: FormLinkPurpose): string | null | undefined {
  const forms = settings.forms as Record<string, unknown> | undefined;
  const value = forms?.[purpose];
  if (typeof value === "string") return value;
  if (value === null) return null;
  return undefined;
}

function formOptionLabel(form: AdminEventFormSummary): string {
  return form.event_name ? `${form.title} · ${form.event_name}` : form.title;
}

function GeneralTab({ event, onUpdated }: { event: EventDetail; onUpdated: (d: EventDetail) => void }) {
  const [name, setName] = useState(event.name ?? "");
  const [timezone, setTimezone] = useState(event.timezone ?? "UTC");
  const [startsAt, setStartsAt] = useState(toLocalDt(event.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalDt(event.ends_at));
  const [venue, setVenue] = useState(event.venue ?? "");
  const [virtualUrl, setVirtualUrl] = useState(event.virtual_url ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(event.hero_image_url ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [sessionTypes, setSessionTypes] = useState(
    event.session_types ?? [{ label: "", requiresPresentation: true }],
  );
  const registrationLink = formLinkValue(event.settings, "event_registration");
  const proposalLink = formLinkValue(event.settings, "proposal_submission");
  const [registrationFormKey, setRegistrationFormKey] = useState(
    typeof registrationLink === "string" ? registrationLink : "",
  );
  const [registrationFormMode, setRegistrationFormMode] = useState<FormLinkMode>(
    registrationLink === undefined ? "unset" : registrationLink === null ? "none" : "explicit",
  );
  const [proposalFormKey, setProposalFormKey] = useState(typeof proposalLink === "string" ? proposalLink : "");
  const [proposalFormMode, setProposalFormMode] = useState<FormLinkMode>(
    proposalLink === undefined ? "unset" : proposalLink === null ? "none" : "explicit",
  );
  const [forms, setForms] = useState<AdminEventFormSummary[]>([]);
  const [formsLoading, setFormsLoading] = useState(true);
  const [formsLoaded, setFormsLoaded] = useState(false);
  const [mode, setMode] = useState(event.registration_mode ?? "invite_or_open");
  const [inviteLimit, setInviteLimit] = useState(event.invite_limit_attendee ?? 5);
  const [retentionDays, setRetentionDays] = useState(
    event.user_retention_days ? String(event.user_retention_days) : "",
  );
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault();
      setSaving(true);
      setStatus("Saving…");
      try {
        const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
        const body: Record<string, unknown> = {
          name: name.trim(),
          timezone: timezone.trim() || "UTC",
          registrationMode: mode,
          startsAt: toIso(startsAt),
          endsAt: toIso(endsAt),
          venue: venue.trim() || null,
          virtualUrl: virtualUrl.trim() || null,
          heroImageUrl: heroImageUrl.trim() || null,
          location: location.trim() || null,
          sessionTypes: sessionTypes.filter((t) => t.label.trim()),
          registrationFormKey: registrationFormMode === "none" ? null : registrationFormKey.trim() || null,
          proposalFormKey: proposalFormMode === "none" ? null : proposalFormKey.trim() || null,
          inviteLimitAttendee: inviteLimit,
        };
        if (retentionDays.trim()) body.userRetentionDays = parseInt(retentionDays.trim(), 10) || undefined;
        const res = await api<{ success: boolean; event: EventDetail }>(`/api/v1/admin/events/${event.slug}/settings`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
        onUpdated(res.event);
        setStatus("✓ Saved");
        toast("Details saved", "success");
      } catch (e) {
        const msg = (e as Error).message;
        setStatus(msg);
        toast(msg, "error");
      } finally {
        setSaving(false);
      }
    },
    [
      name,
      timezone,
      mode,
      startsAt,
      endsAt,
      venue,
      virtualUrl,
      heroImageUrl,
      location,
      sessionTypes,
      registrationFormKey,
      proposalFormKey,
      inviteLimit,
      retentionDays,
      event.slug,
      onUpdated,
    ],
  );

  useEffect(() => {
    setName(event.name ?? "");
    setTimezone(event.timezone ?? "UTC");
    setStartsAt(toLocalDt(event.starts_at));
    setEndsAt(toLocalDt(event.ends_at));
    setVenue(event.venue ?? "");
    setVirtualUrl(event.virtual_url ?? "");
    setHeroImageUrl(event.hero_image_url ?? "");
    setLocation(event.location ?? "");
    setSessionTypes(event.session_types ?? [{ label: "", requiresPresentation: true }]);
    const nextRegistrationLink = formLinkValue(event.settings, "event_registration");
    const nextProposalLink = formLinkValue(event.settings, "proposal_submission");
    setRegistrationFormKey(typeof nextRegistrationLink === "string" ? nextRegistrationLink : "");
    setRegistrationFormMode(
      nextRegistrationLink === undefined ? "unset" : nextRegistrationLink === null ? "none" : "explicit",
    );
    setProposalFormKey(typeof nextProposalLink === "string" ? nextProposalLink : "");
    setProposalFormMode(nextProposalLink === undefined ? "unset" : nextProposalLink === null ? "none" : "explicit");
    setMode(event.registration_mode ?? "invite_or_open");
    setInviteLimit(event.invite_limit_attendee ?? 5);
    setRetentionDays(event.user_retention_days ? String(event.user_retention_days) : "");
  }, [
    event.name,
    event.timezone,
    event.starts_at,
    event.ends_at,
    event.venue,
    event.virtual_url,
    event.hero_image_url,
    event.location,
    event.session_types,
    event.settings,
    event.registration_mode,
    event.invite_limit_attendee,
    event.user_retention_days,
  ]);

  const loadForms = useCallback(async () => {
    setFormsLoading(true);
    setFormsLoaded(false);
    try {
      const data = await api<{ forms: AdminEventFormSummary[] }>(`/api/v1/admin/events/${event.slug}/forms`);
      setForms(data.forms ?? []);
    } catch {
      setForms([]);
    } finally {
      setFormsLoading(false);
      setFormsLoaded(true);
    }
  }, [event.slug]);

  useEffect(() => {
    void loadForms();
  }, [loadForms]);

  const registrationForms = forms.filter((form) => form.purpose === "event_registration" && form.status === "active");
  const proposalForms = forms.filter((form) => form.purpose === "proposal_submission" && form.status === "active");

  useEffect(() => {
    if (!formsLoaded) return;
    if (registrationFormMode === "unset") {
      const currentRegistration = registrationForms[0]?.key ?? "";
      setRegistrationFormKey(currentRegistration);
      setRegistrationFormMode(currentRegistration ? "explicit" : "none");
    }
    if (proposalFormMode === "unset") {
      const currentProposal = proposalForms[0]?.key ?? "";
      setProposalFormKey(currentProposal);
      setProposalFormMode(currentProposal ? "explicit" : "none");
    }
  }, [formsLoaded, registrationFormMode, registrationForms, proposalFormMode, proposalForms]);

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 mb-2">
        <div class="col-md-8">
          <label class="form-label small fw-semibold">Event Name</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={name}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
            required
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Slug (read-only)</label>
          <input class="form-control form-control-sm mono" type="text" value={event.slug} disabled />
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
            required
          />
        </div>
      </div>
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Venue</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={venue}
            onInput={(e) => setVenue((e.target as HTMLInputElement).value)}
            placeholder="City, Country"
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
      <div class="row g-2 mb-2">
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Hero image URL</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={heroImageUrl}
            onInput={(e) => setHeroImageUrl((e.target as HTMLInputElement).value)}
            placeholder="/events/2026/my-event/hero.png"
          />
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Location label</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={location}
            onInput={(e) => setLocation((e.target as HTMLInputElement).value)}
            placeholder="Amsterdam, The Netherlands"
          />
        </div>
      </div>
      <div class="mb-3">
        <label class="form-label small fw-semibold">Session types</label>
        {sessionTypes.map((t, i) => (
          <div key={i} class="d-flex gap-2 align-items-center mb-1">
            <input
              class="form-control form-control-sm"
              type="text"
              value={t.label}
              placeholder="e.g. talk, keynote, panel"
              onInput={(e) => {
                const updated = [...sessionTypes];
                updated[i] = { ...updated[i], label: (e.target as HTMLInputElement).value };
                setSessionTypes(updated);
              }}
            />
            <div class="form-check form-check-inline mb-0 text-nowrap">
              <input
                class="form-check-input"
                type="checkbox"
                id={`rp-${i}`}
                checked={t.requiresPresentation}
                onChange={(e) => {
                  const updated = [...sessionTypes];
                  updated[i] = { ...updated[i], requiresPresentation: (e.target as HTMLInputElement).checked };
                  setSessionTypes(updated);
                }}
              />
              <label class="form-check-label small" for={`rp-${i}`}>
                Requires presentation
              </label>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              onClick={() => setSessionTypes(sessionTypes.filter((_, j) => j !== i))}
              title="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          class="btn btn-sm btn-outline-secondary mt-1"
          onClick={() => setSessionTypes([...sessionTypes, { label: "", requiresPresentation: true }])}
        >
          + Add session type
        </button>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Registration form</label>
          <select
            class="form-select form-select-sm"
            value={registrationFormKey}
            onChange={(e) => {
              const value = (e.target as HTMLSelectElement).value;
              setRegistrationFormKey(value);
              setRegistrationFormMode(value ? "explicit" : "none");
            }}
            disabled={formsLoading}
          >
            <option value="">No form</option>
            {registrationFormKey && !registrationForms.some((form) => form.key === registrationFormKey) && (
              <option value={registrationFormKey}>{registrationFormKey} (linked, unavailable)</option>
            )}
            {registrationForms.map((form) => (
              <option key={form.key} value={form.key}>
                {formOptionLabel(form)}
              </option>
            ))}
          </select>
          <div class="form-text">Choose the form this event should use for registrations.</div>
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Proposal form</label>
          <select
            class="form-select form-select-sm"
            value={proposalFormKey}
            onChange={(e) => {
              const value = (e.target as HTMLSelectElement).value;
              setProposalFormKey(value);
              setProposalFormMode(value ? "explicit" : "none");
            }}
            disabled={formsLoading}
          >
            <option value="">No form</option>
            {proposalFormKey && !proposalForms.some((form) => form.key === proposalFormKey) && (
              <option value={proposalFormKey}>{proposalFormKey} (linked, unavailable)</option>
            )}
            {proposalForms.map((form) => (
              <option key={form.key} value={form.key}>
                {formOptionLabel(form)}
              </option>
            ))}
          </select>
          <div class="form-text">Choose the form this event should use for proposals.</div>
        </div>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Registration Mode</label>
          <select
            class="form-select form-select-sm"
            value={mode}
            onChange={(e) => setMode((e.target as HTMLSelectElement).value)}
          >
            <option value="open">Open</option>
            <option value="invite_or_open">Invite or Open</option>
            <option value="invite_only">Invite Only</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label small fw-semibold">Invite Limit / Attendee</label>
          <input
            class="form-control form-control-sm"
            type="number"
            value={inviteLimit}
            onInput={(e) => setInviteLimit(Number((e.target as HTMLInputElement).value))}
          />
        </div>
        <div class="col-md-3">
          <label class="form-label small fw-semibold">User Retention (days)</label>
          <input
            class="form-control form-control-sm"
            type="number"
            value={retentionDays}
            onInput={(e) => setRetentionDays((e.target as HTMLInputElement).value)}
            placeholder="No policy"
          />
        </div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
          Save Changes
        </button>
        {status && <span class={`small ${status.startsWith("✓") ? "text-success" : "text-danger"}`}>{status}</span>}
      </div>
    </form>
  );
}

// ─── Days tab ────────────────────────────────────────────────────────────────

function DayOptionRow({
  opt,
  onChange,
  onRemove,
}: {
  opt: AdminAttendanceOption;
  onChange: (o: AdminAttendanceOption) => void;
  onRemove: () => void;
}) {
  return (
    <div class="d-flex gap-2 align-items-center mb-1">
      <input
        class="form-control form-control-sm"
        type="text"
        placeholder="value (e.g. in_person)"
        value={opt.value}
        onInput={(e) => onChange({ ...opt, value: (e.target as HTMLInputElement).value })}
      />
      <input
        class="form-control form-control-sm"
        type="text"
        placeholder="Label"
        value={opt.label}
        onInput={(e) => onChange({ ...opt, label: (e.target as HTMLInputElement).value })}
      />
      <input
        class="form-control form-control-sm"
        type="number"
        placeholder="Capacity"
        value={opt.capacity ?? ""}
        onInput={(e) =>
          onChange({
            ...opt,
            capacity: (e.target as HTMLInputElement).value ? parseInt((e.target as HTMLInputElement).value) : null,
          })
        }
      />
      <button type="button" class="btn btn-sm btn-outline-danger" onClick={onRemove}>
        ×
      </button>
    </div>
  );
}

interface DayState {
  id?: string;
  date: string;
  label: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  attendanceOptions: AdminAttendanceOption[];
}

function DaysTab({ slug, timezone }: { slug: string; timezone: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState<DayState[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  function timeInZone(iso: string | null | undefined): string {
    if (!iso || !timezone) return "";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ days: AdminEventDay[] }>(`/api/v1/admin/events/${slug}/days`);
      setDays(
        (data.days ?? []).map((d) => ({
          id: d.id,
          date: d.date,
          label: d.label ?? "",
          startTime: timeInZone(d.startsAt),
          endTime: timeInZone(d.endsAt),
          sortOrder: d.sortOrder,
          attendanceOptions: d.attendanceOptions ?? [],
        })),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug, timezone]);

  useEffect(() => {
    void load();
  }, [load]);

  function addDay() {
    setDays((prev) => [
      ...prev,
      { date: "", label: "", startTime: "", endTime: "", sortOrder: (prev.length + 1) * 10, attendanceOptions: [] },
    ]);
  }

  function updateDay(idx: number, patch: Partial<DayState>) {
    setDays((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  }

  function removeDay(idx: number) {
    setDays((prev) => prev.filter((_, i) => i !== idx));
  }

  function addOption(dayIdx: number) {
    updateDay(dayIdx, {
      attendanceOptions: [...days[dayIdx].attendanceOptions, { value: "", label: "", capacity: null }],
    });
  }

  function updateOption(dayIdx: number, optIdx: number, opt: AdminAttendanceOption) {
    const opts = days[dayIdx].attendanceOptions.map((o, i) => (i === optIdx ? opt : o));
    updateDay(dayIdx, { attendanceOptions: opts });
  }

  function removeOption(dayIdx: number, optIdx: number) {
    const opts = days[dayIdx].attendanceOptions.filter((_, i) => i !== optIdx);
    updateDay(dayIdx, { attendanceOptions: opts });
  }

  async function handleSave() {
    setSaving(true);
    setSaveStatus("Saving…");
    try {
      const body = days
        .filter((d) => d.date.trim())
        .map((d) => ({
          date: d.date.trim(),
          label: d.label.trim() || undefined,
          startTime: d.startTime.trim() || undefined,
          endTime: d.endTime.trim() || undefined,
          sortOrder: d.sortOrder,
          attendanceOptions: d.attendanceOptions.filter((o) => o.value && o.label),
        }));
      const res = await api<{ skipped?: string[] }>(`/api/v1/admin/events/${slug}/days`, {
        method: "PUT",
        body: JSON.stringify({ days: body }),
      });
      const skipped = res.skipped ?? [];
      setSaveStatus(skipped.length ? `Saved with warnings. Could not remove: ${skipped.join(", ")}` : "✓ Saved");
      toast("Event days updated", "success");
      void load();
    } catch (e) {
      const msg = (e as Error).message;
      setSaveStatus(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="d-flex gap-2 align-items-center mb-3 flex-wrap">
        <span class="small text-muted">Manage per-day attendance options and local event times</span>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>
          ↺ Refresh
        </button>
        <button class="btn btn-sm btn-success" onClick={addDay}>
          + Add day
        </button>
        <button class="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={saving}>
          Save Days
        </button>
      </div>
      {saveStatus && (
        <div class={`small mb-2 ${saveStatus.startsWith("✓") ? "text-success" : "text-warning"}`}>{saveStatus}</div>
      )}

      {days.map((day, idx) => (
        <div key={idx} class="card border mb-3">
          <div class="card-body">
            <div class="row g-2 mb-2">
              <div class="col-md-3">
                <label class="form-label small mb-1">Date</label>
                <input
                  class="form-control form-control-sm"
                  type="date"
                  value={day.date}
                  onInput={(e) => updateDay(idx, { date: (e.target as HTMLInputElement).value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1">Starts at</label>
                <input
                  class="form-control form-control-sm"
                  type="time"
                  step={60}
                  value={day.startTime}
                  onInput={(e) => updateDay(idx, { startTime: (e.target as HTMLInputElement).value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1">Ends at</label>
                <input
                  class="form-control form-control-sm"
                  type="time"
                  step={60}
                  value={day.endTime}
                  onInput={(e) => updateDay(idx, { endTime: (e.target as HTMLInputElement).value })}
                />
              </div>
              <div class="col-md-3">
                <label class="form-label small mb-1">Sort</label>
                <input
                  class="form-control form-control-sm"
                  type="number"
                  value={day.sortOrder}
                  onInput={(e) => updateDay(idx, { sortOrder: parseInt((e.target as HTMLInputElement).value) || 0 })}
                />
              </div>
            </div>
            <div class="row g-2 mb-2">
              <div class="col-md-10">
                <label class="form-label small mb-1">Label</label>
                <input
                  class="form-control form-control-sm"
                  value={day.label}
                  onInput={(e) => updateDay(idx, { label: (e.target as HTMLInputElement).value })}
                  placeholder="Thursday 3 December 2026"
                />
              </div>
              <div class="col-md-2 d-flex align-items-end">
                <button type="button" class="btn btn-sm btn-outline-danger w-100" onClick={() => removeDay(idx)}>
                  Remove
                </button>
              </div>
            </div>
            <div class="small fw-semibold mb-1">Attendance options</div>
            {day.attendanceOptions.map((opt, oi) => (
              <DayOptionRow
                key={oi}
                opt={opt}
                onChange={(o) => updateOption(idx, oi, o)}
                onRemove={() => removeOption(idx, oi)}
              />
            ))}
            <button type="button" class="btn btn-sm btn-outline-secondary mt-1" onClick={() => addOption(idx)}>
              + Option
            </button>
          </div>
        </div>
      ))}

      {days.length === 0 && <p class="text-muted fst-italic small">No days configured yet.</p>}
    </div>
  );
}

// ─── Terms tab ───────────────────────────────────────────────────────────────

interface TermState {
  termKey: string;
  version: string;
  required: boolean;
  contentRef: string;
  displayText: string;
  helpText: string;
}

function emptyTerm(): TermState {
  return { termKey: "", version: "1.0", required: true, contentRef: "", displayText: "", helpText: "" };
}

function termFromRow(t: AdminEventTerm): TermState {
  return {
    termKey: t.term_key,
    version: t.version,
    required: !!t.required,
    contentRef: t.content_ref ?? "",
    displayText: t.display_text ?? "",
    helpText: t.help_text ?? "",
  };
}

function TermRow({
  term,
  onChange,
  onRemove,
}: {
  term: TermState;
  onChange: (t: TermState) => void;
  onRemove: () => void;
}) {
  const upd = (patch: Partial<TermState>) => onChange({ ...term, ...patch });
  return (
    <div class="card border mb-2">
      <div class="card-body py-2 px-3">
        <div class="row g-2 mb-2">
          <div class="col-md-3">
            <label class="form-label small mb-1">Key</label>
            <input
              class="form-control form-control-sm mono"
              value={term.termKey}
              onInput={(e) => upd({ termKey: (e.target as HTMLInputElement).value })}
              placeholder="terms-of-service"
            />
          </div>
          <div class="col-md-2">
            <label class="form-label small mb-1">Version</label>
            <input
              class="form-control form-control-sm mono"
              value={term.version}
              onInput={(e) => upd({ version: (e.target as HTMLInputElement).value })}
              placeholder="1.0"
            />
          </div>
          <div class="col-md-5">
            <label class="form-label small mb-1">Link URL</label>
            <input
              class="form-control form-control-sm"
              type="url"
              value={term.contentRef}
              onInput={(e) => upd({ contentRef: (e.target as HTMLInputElement).value })}
              placeholder="https://..."
            />
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <div class="form-check">
              <input
                class="form-check-input"
                type="checkbox"
                checked={term.required}
                onChange={(e) => upd({ required: (e.target as HTMLInputElement).checked })}
                id={`req-${term.termKey}`}
              />
              <label class="form-check-label small" for={`req-${term.termKey}`}>
                Req
              </label>
            </div>
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <button type="button" class="btn btn-sm btn-outline-danger" onClick={onRemove}>
              ✕
            </button>
          </div>
        </div>
        <div class="row g-2">
          <div class="col-md-6">
            <label class="form-label small mb-1">Display text</label>
            <input
              class="form-control form-control-sm"
              value={term.displayText}
              onInput={(e) => upd({ displayText: (e.target as HTMLInputElement).value })}
              placeholder="I agree to the Terms of Service"
            />
          </div>
          <div class="col-md-6">
            <label class="form-label small mb-1">Help text</label>
            <input
              class="form-control form-control-sm"
              value={term.helpText}
              onInput={(e) => upd({ helpText: (e.target as HTMLInputElement).value })}
              placeholder="Optional help text shown below"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function TermsTab({ slug }: { slug: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attendee, setAttendee] = useState<TermState[]>([]);
  const [speaker, setSpeaker] = useState<TermState[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ terms: { attendee: AdminEventTerm[]; speaker: AdminEventTerm[] } }>(
        `/api/v1/admin/events/${slug}/terms`,
      );
      setAttendee((data.terms?.attendee ?? []).map(termFromRow));
      setSpeaker((data.terms?.speaker ?? []).map(termFromRow));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [slug]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    setSaveStatus("Saving…");
    try {
      const toPayload = (list: TermState[]) =>
        list
          .filter((t) => t.termKey.trim() && t.displayText.trim())
          .map((t) => ({
            termKey: t.termKey.trim(),
            version: t.version.trim() || "1.0",
            required: t.required,
            contentRef: t.contentRef.trim() || undefined,
            displayText: t.displayText.trim(),
            helpText: t.helpText.trim() || undefined,
          }));
      await api(`/api/v1/admin/events/${slug}/terms`, {
        method: "PUT",
        body: JSON.stringify({ attendee: toPayload(attendee), speaker: toPayload(speaker) }),
      });
      setSaveStatus("✓ Saved");
      toast("Terms updated", "success");
      void load();
    } catch (e) {
      const msg = (e as Error).message;
      setSaveStatus(msg);
      toast(msg, "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <Spinner />;
  if (error) return <ErrorAlert error={error} />;

  return (
    <div>
      <div class="d-flex gap-2 align-items-center mb-3 flex-wrap">
        <span class="small text-muted">Manage terms &amp; conditions shown during registration</span>
        <button class="btn btn-sm btn-outline-secondary ms-auto" onClick={() => void load()}>
          ↺ Refresh
        </button>
        <button class="btn btn-sm btn-primary" onClick={() => void handleSave()} disabled={saving}>
          Save Terms
        </button>
      </div>
      {saveStatus && (
        <div class={`small mb-2 ${saveStatus.startsWith("✓") ? "text-success" : "text-warning"}`}>{saveStatus}</div>
      )}

      <h6 class="small fw-bold text-uppercase text-muted mb-2">Attendee Terms</h6>
      {attendee.map((t, i) => (
        <TermRow
          key={i}
          term={t}
          onChange={(u) => setAttendee((prev) => prev.map((x, j) => (j === i ? u : x)))}
          onRemove={() => setAttendee((prev) => prev.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary mb-4"
        onClick={() => setAttendee((prev) => [...prev, emptyTerm()])}
      >
        + Add attendee term
      </button>

      <h6 class="small fw-bold text-uppercase text-muted mb-2">Speaker Terms</h6>
      {speaker.map((t, i) => (
        <TermRow
          key={i}
          term={t}
          onChange={(u) => setSpeaker((prev) => prev.map((x, j) => (j === i ? u : x)))}
          onRemove={() => setSpeaker((prev) => prev.filter((_, j) => j !== i))}
        />
      ))}
      <button
        type="button"
        class="btn btn-sm btn-outline-secondary mb-3"
        onClick={() => setSpeaker((prev) => [...prev, emptyTerm()])}
      >
        + Add speaker term
      </button>
    </div>
  );
}

// ─── Settings compositor ─────────────────────────────────────────────────────

type SettingsTab = "general" | "days" | "terms" | "team";

const SETTINGS_TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "general", label: "General" },
  { key: "days", label: "Days" },
  { key: "terms", label: "Terms" },
  { key: "team", label: "Team" },
];

export function Settings({
  event,
  onUpdated,
  subTab,
}: {
  event: EventDetail;
  onUpdated: (d: EventDetail) => void;
  subTab?: string;
}) {
  const tab: SettingsTab = SETTINGS_TABS.find((t) => t.key === subTab)?.key ?? "general";

  return (
    <div>
      <Tabs
        items={SETTINGS_TABS}
        active={tab}
        onChange={(key) => {
          location.hash = `/events/${event.slug}/settings/${key}`;
        }}
      />

      {tab === "general" && <GeneralTab event={event} onUpdated={onUpdated} />}
      {tab === "days" && <DaysTab slug={event.slug} timezone={event.timezone} />}
      {tab === "terms" && <TermsTab slug={event.slug} />}
      {tab === "team" && <Team slug={event.slug} />}
    </div>
  );
}
