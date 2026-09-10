import { instantToDateTimeLocal, dateTimeLocalToIso } from "../../../../../../../shared/timezone";
import { useContractForm } from "../../../../../../hooks/useContractForm";
import { EditActions } from "../../../../../../ui/EditActions";
import { EventSettingsSummary } from "./EventSettingsSummary";
import { useEffect, useState } from "preact/hooks";
import { patchJson } from "../../../../../../shared/api-client";
import {
  eventSettingsUpdateSchema,
  eventManagementDetailResponseSchema,
} from "../../../../../../../shared/schemas/event-management";
import {
  EVENT_REGISTRATION_POLICIES,
  EVENT_REGISTRATION_POLICY_LABELS,
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

function toLocalDateTime(iso: string | null | undefined, timeZone: string): string {
  if (!iso) return "";
  try {
    return instantToDateTimeLocal(iso, timeZone);
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
  const [startsAt, setStartsAt] = useState(toLocalDateTime(event.startsAt, event.timezone ?? "UTC"));
  const [endsAt, setEndsAt] = useState(toLocalDateTime(event.endsAt, event.timezone ?? "UTC"));
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
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);

  const toIso = (value: string) => {
    if (!value) return null;
    try {
      return dateTimeLocalToIso(value, timezone);
    } catch {
      return value;
    } // The shared UTC contract rejects an invalid wall clock instead of silently shifting it.
  };
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
  if (retentionDays.trim()) body.userRetentionDays = Number(retentionDays);

  const form = useContractForm(eventSettingsUpdateSchema, body);
  async function handleSubmit(submitEvent: Event): Promise<void> {
    submitEvent.preventDefault();
    if (!canWrite || !editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setOutcome({ tone: "danger", message: checked.message });
      return;
    }
    setSaving(true);
    setOutcome(null);
    try {
      const response = await patchJson(
        `/api/v1/events/${encodeURIComponent(event.slug)}/settings`,
        checked.data,
        eventManagementDetailResponseSchema,
      );
      onUpdated(response.event);
      setEditing(false);
      setOutcome({ tone: "ok", message: "Details saved." });
      toast("Details saved", "success");
    } catch (caught) {
      const message = form.refuse(caught);
      setOutcome({ tone: "danger", message });
      toast(message, "error");
    } finally {
      setSaving(false);
    }
  }
  function resetDraft() {
    setName(event.name ?? "");
    setTimezone(event.timezone ?? "UTC");
    setStartsAt(toLocalDateTime(event.startsAt, event.timezone ?? "UTC"));
    setEndsAt(toLocalDateTime(event.endsAt, event.timezone ?? "UTC"));
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
  }
  useEffect(() => {
    resetDraft();
    setEditing(false);
  }, [event]);

  if (!editing)
    return (
      <EventSettingsSummary
        event={event}
        proposalFormKey={proposalLink}
        registrationFormKey={registrationLink}
        outcome={outcome}
        actions={
          canWrite ? (
            <EditActions
              label="Event settings actions"
              editing={false}
              onEdit={() => {
                resetDraft();
                form.reset();
                setOutcome(null);
                setEditing(true);
              }}
              onCancel={() => undefined}
            />
          ) : undefined
        }
      />
    );

  return (
    <div class="pk">
      <form noValidate class="pk-stack" {...form.handlers} onSubmit={handleSubmit}>
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
            <PanelHeader title="Event details" headingLevel={2}>
              <EditActions
                label="Event settings actions"
                editing
                saving={saving}
                onEdit={() => undefined}
                onCancel={() => {
                  resetDraft();
                  form.reset();
                  setOutcome(null);
                  setEditing(false);
                }}
              />
            </PanelHeader>
            <PanelBody class="pk-stack">
              <div class="pk-grid">
                <Field {...form.of("name")} label="Event name" required>
                  {(control) => (
                    <TextInput
                      {...control}
                      name="name"
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
                fields={form.of}
                startsAt={startsAt}
                endsAt={endsAt}
                timezone={timezone}
                onStartsAtChange={setStartsAt}
                onEndsAtChange={setEndsAt}
                onTimezoneChange={setTimezone}
              />

              <div class="pk-grid">
                <Field {...form.of("venue")} label="Venue">
                  {(control) => (
                    <TextInput
                      {...control}
                      name="venue"
                      value={venue}
                      placeholder="City, Country"
                      onInput={(inputEvent) => setVenue((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field {...form.of("virtualUrl")} label="Virtual URL">
                  {(control) => (
                    <TextInput
                      {...control}
                      name="virtualUrl"
                      type="url"
                      value={virtualUrl}
                      placeholder="https://..."
                      onInput={(inputEvent) => setVirtualUrl((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field {...form.of("heroImageUrl")} label="Hero image URL">
                  {(control) => (
                    <TextInput
                      {...control}
                      name="heroImageUrl"
                      value={heroImageUrl}
                      placeholder="/events/2026/my-event/hero.png"
                      onInput={(inputEvent) => setHeroImageUrl((inputEvent.target as HTMLInputElement).value)}
                    />
                  )}
                </Field>
                <Field {...form.of("location")} label="Location label">
                  {(control) => (
                    <TextInput
                      {...control}
                      name="location"
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
                  {...form.of("visibility")}
                  label="Event visibility"
                  help="Controls event discovery; registration and attendance policies remain separate."
                >
                  {(control) => (
                    <Select
                      {...control}
                      name="visibility"
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
                  <Field {...form.of("registrationPolicy")} label="Registration mode">
                    {(control) => (
                      <Select
                        {...control}
                        name="registrationPolicy"
                        value={mode}
                        onChange={(changeEvent) =>
                          setMode((changeEvent.target as HTMLSelectElement).value as EventDetail["registrationPolicy"])
                        }
                      >
                        {/* The policies and their words both come from the
                            contract, the way the visibility field above
                            already reads them. */}
                        {EVENT_REGISTRATION_POLICIES.map((policy) => (
                          <option key={policy} value={policy}>
                            {EVENT_REGISTRATION_POLICY_LABELS[policy]}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                )}
                <Field {...form.of("inviteLimitAttendee")} label="Invite limit per attendee">
                  {(control) => (
                    <TextInput
                      {...control}
                      name="inviteLimitAttendee"
                      type="number"
                      value={inviteLimit}
                      onInput={(inputEvent) => setInviteLimit(Number((inputEvent.target as HTMLInputElement).value))}
                    />
                  )}
                </Field>
                <Field {...form.of("userRetentionDays")} label="User retention (days)">
                  {(control) => (
                    <TextInput
                      {...control}
                      name="userRetentionDays"
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
        </fieldset>

        {outcome && <Alert tone={outcome.tone}>{outcome.message}</Alert>}
      </form>
    </div>
  );
}
