import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../../../../api";
import type { AdminEventFormSummary, EventDetail } from "../../../../types";
import { toast } from "../../../../ui";

type FormLinkPurpose = "event_registration" | "proposal_submission";
type FormLinkMode = "unset" | "none" | "explicit";

function toLocalDateTime(iso: string | null | undefined): string {
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

export function GeneralTab({ event, onUpdated }: { event: EventDetail; onUpdated: (event: EventDetail) => void }) {
  const [name, setName] = useState(event.name ?? "");
  const [timezone, setTimezone] = useState(event.timezone ?? "UTC");
  const [startsAt, setStartsAt] = useState(toLocalDateTime(event.starts_at));
  const [endsAt, setEndsAt] = useState(toLocalDateTime(event.ends_at));
  const [venue, setVenue] = useState(event.venue ?? "");
  const [virtualUrl, setVirtualUrl] = useState(event.virtual_url ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(event.hero_image_url ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [sessionTypes, setSessionTypes] = useState(event.session_types ?? [{ label: "", requiresPresentation: true }]);
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
    async (submitEvent: Event) => {
      submitEvent.preventDefault();
      setSaving(true);
      setStatus("Saving…");
      try {
        const toIso = (value: string) => (value ? new Date(value).toISOString() : null);
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
          sessionTypes: sessionTypes.filter((sessionType) => sessionType.label.trim()),
          registrationFormKey: registrationFormMode === "none" ? null : registrationFormKey.trim() || null,
          proposalFormKey: proposalFormMode === "none" ? null : proposalFormKey.trim() || null,
          inviteLimitAttendee: inviteLimit,
        };
        if (retentionDays.trim()) body.userRetentionDays = parseInt(retentionDays.trim(), 10) || undefined;
        const response = await api<{ success: boolean; event: EventDetail }>(
          `/api/v1/admin/events/${event.slug}/settings`,
          { method: "PATCH", body: JSON.stringify(body) },
        );
        onUpdated(response.event);
        setStatus("✓ Saved");
        toast("Details saved", "success");
      } catch (caught) {
        const message = (caught as Error).message;
        setStatus(message);
        toast(message, "error");
      } finally {
        setSaving(false);
      }
    },
    [
      endsAt,
      event.slug,
      heroImageUrl,
      inviteLimit,
      location,
      mode,
      name,
      onUpdated,
      proposalFormKey,
      proposalFormMode,
      registrationFormKey,
      registrationFormMode,
      retentionDays,
      sessionTypes,
      startsAt,
      timezone,
      venue,
      virtualUrl,
    ],
  );

  useEffect(() => {
    setName(event.name ?? "");
    setTimezone(event.timezone ?? "UTC");
    setStartsAt(toLocalDateTime(event.starts_at));
    setEndsAt(toLocalDateTime(event.ends_at));
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
  }, [event]);

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
  }, [formsLoaded, proposalFormMode, proposalForms, registrationFormMode, registrationForms]);

  return (
    <form onSubmit={handleSubmit}>
      <div class="row g-2 mb-2">
        <div class="col-md-8">
          <label class="form-label small fw-semibold">Event Name</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={name}
            onInput={(event) => setName((event.target as HTMLInputElement).value)}
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
            onInput={(event) => setStartsAt((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">End date</label>
          <input
            class="form-control form-control-sm"
            type="datetime-local"
            value={endsAt}
            onInput={(event) => setEndsAt((event.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold">Timezone</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={timezone}
            onInput={(event) => setTimezone((event.target as HTMLInputElement).value)}
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
            onInput={(event) => setVenue((event.target as HTMLInputElement).value)}
            placeholder="City, Country"
          />
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Virtual URL</label>
          <input
            class="form-control form-control-sm"
            type="url"
            value={virtualUrl}
            onInput={(event) => setVirtualUrl((event.target as HTMLInputElement).value)}
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
            onInput={(event) => setHeroImageUrl((event.target as HTMLInputElement).value)}
            placeholder="/events/2026/my-event/hero.png"
          />
        </div>
        <div class="col-md-6">
          <label class="form-label small fw-semibold">Location label</label>
          <input
            class="form-control form-control-sm"
            type="text"
            value={location}
            onInput={(event) => setLocation((event.target as HTMLInputElement).value)}
            placeholder="Amsterdam, the Netherlands"
          />
        </div>
      </div>
      <div class="mb-3">
        <label class="form-label small fw-semibold">Session types</label>
        {sessionTypes.map((sessionType, index) => (
          <div key={index} class="d-flex gap-2 align-items-center mb-1">
            <input
              class="form-control form-control-sm"
              type="text"
              value={sessionType.label}
              placeholder="e.g. talk, keynote, panel"
              onInput={(event) => {
                const updated = [...sessionTypes];
                updated[index] = { ...updated[index], label: (event.target as HTMLInputElement).value };
                setSessionTypes(updated);
              }}
            />
            <div class="form-check form-check-inline mb-0 text-nowrap">
              <input
                class="form-check-input"
                type="checkbox"
                id={`rp-${index}`}
                checked={sessionType.requiresPresentation}
                onChange={(event) => {
                  const updated = [...sessionTypes];
                  updated[index] = {
                    ...updated[index],
                    requiresPresentation: (event.target as HTMLInputElement).checked,
                  };
                  setSessionTypes(updated);
                }}
              />
              <label class="form-check-label small" for={`rp-${index}`}>
                Requires presentation
              </label>
            </div>
            <button
              type="button"
              class="btn btn-sm btn-outline-danger"
              onClick={() => setSessionTypes(sessionTypes.filter((_, itemIndex) => itemIndex !== index))}
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
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
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
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
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
            onChange={(event) => setMode((event.target as HTMLSelectElement).value)}
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
            onInput={(event) => setInviteLimit(Number((event.target as HTMLInputElement).value))}
          />
        </div>
        <div class="col-md-3">
          <label class="form-label small fw-semibold">User Retention (days)</label>
          <input
            class="form-control form-control-sm"
            type="number"
            value={retentionDays}
            onInput={(event) => setRetentionDays((event.target as HTMLInputElement).value)}
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
