import { useCallback, useEffect, useState } from "preact/hooks";
import { patchJson } from "../../../../../../shared/api-client";
import { eventManagementDetailResponseSchema } from "../../../../../../../shared/schemas/event-management";
import {
  EVENT_VISIBILITIES,
  EVENT_VISIBILITY_LABELS,
  type EventVisibility,
} from "../../../../../../../shared/schemas/event-series";
import type { EventDetail } from "../../types";
import { toast } from "../../../../ui";
import { Alert } from "../../../../../../ui/Alert";
import { Button } from "../../../../../../ui/Button";
import { Checkbox } from "../../../../../../ui/Checkbox";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { EventScheduleFields } from "../../../../../../components/EventScheduleFields";
import { EventFormLinkSelect } from "./EventFormLinkSelect";
import "../../../../../../ui/Content.css";

type FormLinkPurpose = "event_registration" | "proposal_submission";
type FormLinkMode = "unset" | "none" | "explicit";

/**
 * The outcome of a save, as the reader sees it.
 *
 * The Bootstrap surface put "✓ Saved" and the failure message in the same span
 * and told them apart with `text-success` / `text-danger`, so the two outcomes
 * differed only by hue. An Alert carries the tone and the role together —
 * `status` for a success, `alert` for a failure — so the result is announced
 * rather than merely coloured.
 */
interface SaveOutcome {
  tone: "ok" | "danger";
  message: string;
}

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
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

  const handleSubmit = useCallback(
    async (submitEvent: Event) => {
      submitEvent.preventDefault();
      if (!canWrite) return;
      setSaving(true);
      setOutcome(null);
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
        const response = await patchJson(
          `/api/v1/events/${encodeURIComponent(event.slug)}/settings`,
          body,
          eventManagementDetailResponseSchema,
        );
        onUpdated(response.event);
        setOutcome({ tone: "ok", message: "Details saved." });
        toast("Details saved", "success");
      } catch (caught) {
        const message = (caught as Error).message;
        setOutcome({ tone: "danger", message });
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
    <div class="pk">
      <form class="pk-stack" onSubmit={handleSubmit}>
        {/* One disabled fieldset is what keeps a reader out of every control,
            including the schedule fields this surface renders through a child
            component it cannot disable one prop at a time. */}
        <fieldset class="pk-fieldset pk-stack" disabled={!canWrite || saving}>
          {!canWrite && (
            <Alert tone="info" title="Read-only">
              You can view these settings but not change them.
            </Alert>
          )}

          <Panel>
            <PanelHeader title="Event details" headingLevel={2} />
            <PanelBody class="pk-stack">
              <div class="pk-grid">
                <Field label="Event name" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      value={name}
                      onInput={(inputEvent) => setName((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Slug" help="Set when the event is created; it cannot be changed here.">
                  {(control) => <TextInput {...control} class="pk-mono" value={event.slug} disabled />}
                </Field>
              </div>

              <EventScheduleFields
                startsAt={startsAt}
                endsAt={endsAt}
                timezone={timezone}
                onStartsAtChange={setStartsAt}
                onEndsAtChange={setEndsAt}
                onTimezoneChange={setTimezone}
              />

              <div class="pk-grid">
                <Field label="Venue">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={venue}
                      placeholder="City, Country"
                      onInput={(inputEvent) => setVenue((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Virtual URL">
                  {(control) => (
                    <TextInput
                      {...control}
                      type="url"
                      value={virtualUrl}
                      placeholder="https://..."
                      onInput={(inputEvent) => setVirtualUrl((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Hero image URL">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={heroImageUrl}
                      placeholder="/events/2026/my-event/hero.png"
                      onInput={(inputEvent) => setHeroImageUrl((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field label="Location label">
                  {(control) => (
                    <TextInput
                      {...control}
                      value={location}
                      placeholder="Amsterdam, the Netherlands"
                      onInput={(inputEvent) => setLocation((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Session types" headingLevel={2} />
            <PanelBody class="pk-stack">
              {sessionTypes.map((sessionType, index) => (
                // A row has no identity until it is named, so its position is
                // the only stable key available.
                <div key={index} class="pk-stack pk-stack--tight">
                  <Field label={`Session type ${String(index + 1)}`}>
                    {(control) => (
                      <TextInput
                        {...control}
                        value={sessionType.label}
                        placeholder="e.g. talk, keynote, panel"
                        onInput={(inputEvent) => {
                          const updated = [...sessionTypes];
                          updated[index] = {
                            ...updated[index],
                            label: (inputEvent.target as HTMLInputElement).value,
                          };
                          setSessionTypes(updated);
                        }}
                      />
                    )}
                  </Field>
                  <div class="pk-cluster">
                    <Checkbox
                      checked={sessionType.requiresPresentation}
                      onChange={(changeEvent) => {
                        const updated = [...sessionTypes];
                        updated[index] = {
                          ...updated[index],
                          requiresPresentation: (changeEvent.target as HTMLInputElement).checked,
                        };
                        setSessionTypes(updated);
                      }}
                      label={<span class="pk-small">Requires presentation</span>}
                    />
                    <Button
                      size="sm"
                      variant="danger-quiet"
                      onClick={() => setSessionTypes(sessionTypes.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
              <div class="pk-cluster">
                <Button
                  size="sm"
                  onClick={() => setSessionTypes([...sessionTypes, { label: "", requiresPresentation: true }])}
                >
                  + Add session type
                </Button>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Visibility and registration" headingLevel={2} />
            <PanelBody class="pk-stack">
              <div class="pk-grid">
                <Field
                  label="Event visibility"
                  help="Controls event discovery; registration and attendance policies remain separate."
                >
                  {(control) => (
                    <Select
                      {...control}
                      value={visibility}
                      onChange={(changeEvent) =>
                        setVisibility((changeEvent.target as HTMLSelectElement).value as EventVisibility)
                      }
                    >
                      {EVENT_VISIBILITIES.map((value) => (
                        <option key={value} value={value}>
                          {EVENT_VISIBILITY_LABELS[value]}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                {!portalOwnsRegistration && (
                  <Field label="Registration mode">
                    {(control) => (
                      <Select
                        {...control}
                        value={mode}
                        onChange={(changeEvent) =>
                          setMode((changeEvent.target as HTMLSelectElement).value as EventDetail["registrationPolicy"])
                        }
                      >
                        <option value="public">Public registration</option>
                        <option value="required">Registration required</option>
                        <option value="optional">Optional registration</option>
                        <option value="invitation_only">Invitation only</option>
                        <option value="no_registration">No registration</option>
                      </Select>
                    )}
                  </Field>
                )}
                <Field label="Invite limit per attendee">
                  {(control) => (
                    <TextInput
                      {...control}
                      type="number"
                      value={inviteLimit}
                      onInput={(inputEvent) => setInviteLimit(Number((inputEvent.target as HTMLInputElement).value))}
                    />
                  )}
                </Field>
                <Field label="User retention (days)">
                  {(control) => (
                    <TextInput
                      {...control}
                      type="number"
                      value={retentionDays}
                      placeholder="No policy"
                      onInput={(inputEvent) => setRetentionDays((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
              </div>

              {/* The form pickers still carry their own column width from the
                  shared component, so they sit in a stack rather than a grid
                  that would size them a second time. */}
              <div class="pk-stack">
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
            </PanelBody>
          </Panel>

          {canWrite && (
            <div class="pk-cluster">
              <Button type="submit" variant="primary" loading={saving}>
                Save changes
              </Button>
            </div>
          )}
        </fieldset>

        {outcome && <Alert tone={outcome.tone}>{outcome.message}</Alert>}
      </form>
    </div>
  );
}
