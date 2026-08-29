import { useCallback, useEffect, useState } from "preact/hooks";
import { api } from "../../../../api";
import { eventManagementDetailResponseSchema } from "../../../../../../shared/schemas/event-management";
import {
  EVENT_VISIBILITIES,
  EVENT_VISIBILITY_LABELS,
  type EventVisibility,
} from "../../../../../../shared/schemas/event-series";
import type { EventDetail } from "../../../../types";
import { toast } from "../../../../ui";
import { EventScheduleFields } from "../../../../components/EventScheduleFields";
import { EventFormLinkSelect } from "../../../../components/EventFormLinkSelect";

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

export function GeneralTab({ event, onUpdated }: { event: EventDetail; onUpdated: (event: EventDetail) => void }) {
  const portalOwnsRegistration = event.sourceMode === "portal";
  const canWrite = event.capabilities.includes("write");
  const [name, setName] = useState(event.name ?? "");
  const [timezone, setTimezone] = useState(event.timezone ?? "UTC");
  const [startsAt, setStartsAt] = useState(toLocalDateTime(event.startsAt));
  const [endsAt, setEndsAt] = useState(toLocalDateTime(event.endsAt));
  const [venue, setVenue] = useState(event.venue ?? "");
  const [virtualUrl, setVirtualUrl] = useState(event.virtualUrl ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(event.heroImageUrl ?? "");
  const [location, setLocation] = useState(event.location ?? "");
  const [sessionTypes, setSessionTypes] = useState(event.sessionTypes ?? [{ label: "", requiresPresentation: true }]);
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
  const [mode, setMode] = useState(event.registrationPolicy);
  const [visibility, setVisibility] = useState<EventVisibility>(event.visibility);
  const [inviteLimit, setInviteLimit] = useState(event.inviteLimitAttendee);
  const [retentionDays, setRetentionDays] = useState(event.userRetentionDays ? String(event.userRetentionDays) : "");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");

  const handleSubmit = useCallback(
    async (submitEvent: Event) => {
      submitEvent.preventDefault();
      if (!canWrite) return;
      setSaving(true);
      setStatus("Saving…");
      try {
        const toIso = (value: string) => (value ? new Date(value).toISOString() : null);
        const body: Record<string, unknown> = {
          name: name.trim(),
          timezone: timezone.trim() || "UTC",
          ...(portalOwnsRegistration ? {} : { registrationPolicy: mode }),
          visibility,
          expectedUpdatedAt: event.updatedAt,
          startsAt: toIso(startsAt),
          endsAt: toIso(endsAt),
          venue: venue.trim() || null,
          virtualUrl: virtualUrl.trim() || null,
          heroImageUrl: heroImageUrl.trim() || null,
          location: location.trim() || null,
          sessionTypes: sessionTypes.filter((sessionType) => sessionType.label.trim()),
          ...(portalOwnsRegistration
            ? {}
            : { registrationFormKey: registrationFormMode === "none" ? null : registrationFormKey.trim() || null }),
          proposalFormKey: proposalFormMode === "none" ? null : proposalFormKey.trim() || null,
          inviteLimitAttendee: inviteLimit,
        };
        if (retentionDays.trim()) body.userRetentionDays = parseInt(retentionDays.trim(), 10) || undefined;
        const response = await api(
          `/api/v1/events/${encodeURIComponent(event.slug)}/settings`,
          eventManagementDetailResponseSchema,
          {
            method: "PATCH",
            body: JSON.stringify(body),
          },
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
      canWrite,
      event.updatedAt,
      event.slug,
      heroImageUrl,
      inviteLimit,
      location,
      mode,
      name,
      onUpdated,
      proposalFormKey,
      proposalFormMode,
      portalOwnsRegistration,
      registrationFormKey,
      registrationFormMode,
      retentionDays,
      sessionTypes,
      startsAt,
      timezone,
      venue,
      virtualUrl,
      visibility,
    ],
  );

  useEffect(() => {
    setName(event.name ?? "");
    setTimezone(event.timezone ?? "UTC");
    setStartsAt(toLocalDateTime(event.startsAt));
    setEndsAt(toLocalDateTime(event.endsAt));
    setVenue(event.venue ?? "");
    setVirtualUrl(event.virtualUrl ?? "");
    setHeroImageUrl(event.heroImageUrl ?? "");
    setLocation(event.location ?? "");
    setSessionTypes(event.sessionTypes ?? [{ label: "", requiresPresentation: true }]);
    const nextRegistrationLink = formLinkValue(event.settings, "event_registration");
    const nextProposalLink = formLinkValue(event.settings, "proposal_submission");
    setRegistrationFormKey(typeof nextRegistrationLink === "string" ? nextRegistrationLink : "");
    setRegistrationFormMode(
      nextRegistrationLink === undefined ? "unset" : nextRegistrationLink === null ? "none" : "explicit",
    );
    setProposalFormKey(typeof nextProposalLink === "string" ? nextProposalLink : "");
    setProposalFormMode(nextProposalLink === undefined ? "unset" : nextProposalLink === null ? "none" : "explicit");
    setMode(event.registrationPolicy);
    setVisibility(event.visibility);
    setInviteLimit(event.inviteLimitAttendee);
    setRetentionDays(event.userRetentionDays ? String(event.userRetentionDays) : "");
  }, [event]);

  return (
    <form onSubmit={handleSubmit}>
      <fieldset disabled={!canWrite || saving}>
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
        <EventScheduleFields
          startsAt={startsAt}
          endsAt={endsAt}
          timezone={timezone}
          onStartsAtChange={setStartsAt}
          onEndsAtChange={setEndsAt}
          onTimezoneChange={setTimezone}
        />
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
            <label class="form-label small fw-semibold">Event visibility</label>
            <select
              class="form-select form-select-sm"
              value={visibility}
              onChange={(event) => setVisibility((event.target as HTMLSelectElement).value as EventVisibility)}
            >
              {EVENT_VISIBILITIES.map((value) => (
                <option value={value}>{EVENT_VISIBILITY_LABELS[value]}</option>
              ))}
            </select>
            <div class="form-text">Controls event discovery; registration and attendance policies remain separate.</div>
          </div>
          {!portalOwnsRegistration && (
            <EventFormLinkSelect
              eventSlug={event.slug}
              purpose="event_registration"
              label="Registration form"
              value={registrationFormKey}
              disabled={saving}
              autoSelectFirst={registrationFormMode === "unset"}
              help="Choose the form this event should use for registrations."
              onChange={(value) => {
                setRegistrationFormKey(value);
                setRegistrationFormMode(value ? "explicit" : "none");
              }}
            />
          )}
          <EventFormLinkSelect
            eventSlug={event.slug}
            purpose="proposal_submission"
            label="Proposal form"
            value={proposalFormKey}
            disabled={saving}
            autoSelectFirst={proposalFormMode === "unset"}
            help="Choose the form this event should use for proposals."
            onChange={(value) => {
              setProposalFormKey(value);
              setProposalFormMode(value ? "explicit" : "none");
            }}
          />
        </div>
        <div class="row g-2 mb-3">
          {!portalOwnsRegistration && (
            <div class="col-md-6">
              <label class="form-label small fw-semibold">Registration Mode</label>
              <select
                class="form-select form-select-sm"
                value={mode}
                onChange={(event) =>
                  setMode((event.target as HTMLSelectElement).value as EventDetail["registrationPolicy"])
                }
              >
                <option value="public">Public registration</option>
                <option value="required">Registration required</option>
                <option value="optional">Optional registration</option>
                <option value="invitation_only">Invitation only</option>
                <option value="no_registration">No registration</option>
              </select>
            </div>
          )}
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
          {canWrite && (
            <button type="submit" class="btn btn-sm btn-success" disabled={saving}>
              Save Changes
            </button>
          )}
          {status && <span class={`small ${status.startsWith("✓") ? "text-success" : "text-danger"}`}>{status}</span>}
        </div>
      </fieldset>
    </form>
  );
}
