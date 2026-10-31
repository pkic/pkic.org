import {
  groupEventSettingsUpdateSchema,
  groupEventDetailResponseSchema,
} from "../../../../../../../shared/schemas/group-events";
import { instantToDateTimeLocal, dateTimeLocalToIso } from "../../../../../../../shared/timezone";
import { confirmAction } from "../../../../../../components/ConfirmDialog";
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
  STANDALONE_EVENT_REGISTRATION_POLICIES,
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_VISIBILITIES,
  EVENT_VISIBILITY_LABELS,
  type EventVisibility,
} from "../../../../../../../shared/schemas/event-series";
import type { EventDetail } from "../../types";
import { toast } from "../../../../ui";
import { Alert } from "../../../../../../ui/Alert";
import { Field } from "../../../../../../ui/Field";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { EventScheduleFields } from "../../../../../../components/EventScheduleFields";
import { EventPlaceFields } from "../../../../../../components/EventPlaceFields";
import { EventFormLinkSelect } from "./EventFormLinkSelect";
import { SessionTypeEditor } from "./SessionTypeEditor";
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
 * rather than merely colored.
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

export type EventSettingsSection = "general" | "location" | "session-types" | "registration";
export function GeneralTab({
  event,
  onUpdated,
  section = "general",
  groupSettings,
}: {
  event: EventDetail;
  onUpdated: (event: EventDetail) => void;
  section?: EventSettingsSection;
  groupSettings?: {
    groupId: string;
    eventId: string;
    canEdit: boolean;
    onSaved: (savedSlug?: string) => void | Promise<void>;
  };
}) {
  const portalOwnsRegistration = event.sourceMode === "portal" || !!groupSettings;
  const groupTarget = groupSettings;
  const canWrite = groupTarget ? groupTarget.canEdit : event.capabilities.includes("write");
  const [slug, setSlug] = useState(event.slug);
  const [name, setName] = useState(event.name ?? "");
  const [timezone, setTimezone] = useState(event.timezone ?? "UTC");
  const [startsAt, setStartsAt] = useState(toLocalDateTime(event.startsAt, event.timezone ?? "UTC"));
  const [endsAt, setEndsAt] = useState(toLocalDateTime(event.endsAt, event.timezone ?? "UTC"));
  const [venue, setVenue] = useState(event.venue ?? "");
  const [heroImageUrl, setHeroImageUrl] = useState(event.heroImageUrl ?? "");
  const [city, setCity] = useState(event.city ?? "");
  const [country, setCountry] = useState<string>(event.country ?? "");
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
  const draft: Record<string, unknown> = {
    name: name.trim(),
    ...(slug.trim() !== event.slug ? { slug: slug.trim() } : {}),
    timezone: timezone.trim() || "UTC",
    ...(portalOwnsRegistration ? {} : { registrationPolicy: mode }),
    visibility,
    expectedUpdatedAt: event.updatedAt,
    startsAt: toIso(startsAt),
    endsAt: toIso(endsAt),
    venue: venue.trim() || null,
    heroImageUrl: heroImageUrl.trim() || null,
    city: city.trim() || null,
    country: country.trim() || null,
    sessionTypes: sessionTypes
      .filter((sessionType) => sessionType.label.trim() || sessionType.name?.trim())
      .map((type) => ({ ...type, name: type.name?.trim() || undefined })),
    ...(portalOwnsRegistration
      ? {}
      : { registrationFormKey: registrationFormMode === "none" ? null : registrationFormKey.trim() || null }),
    ...(event.sourceMode === "portal"
      ? {}
      : { proposalFormKey: proposalFormMode === "none" ? null : proposalFormKey.trim() || null }),
    inviteLimitAttendee: inviteLimit,
  };
  if (retentionDays.trim()) draft.userRetentionDays = Number(retentionDays);
  const sectionFields =
    section === "session-types"
      ? ["sessionTypes"]
      : section === "registration"
        ? [
            "visibility",
            "registrationPolicy",
            "registrationFormKey",
            "proposalFormKey",
            "inviteLimitAttendee",
            "userRetentionDays",
          ]
        : section === "location"
          ? ["timezone", "startsAt", "endsAt", "venue", "city", "country"]
          : ["name", "slug", "heroImageUrl"];
  const body = Object.fromEntries(
    Object.entries(draft).filter(([field]) => field === "expectedUpdatedAt" || sectionFields.includes(field)),
  );

  // Blank draft rows are omitted from the request; validation names follow the sent array.
  const sessionTypeDurationPath = (index: number) =>
    `sessionTypes.${sessionTypes.slice(0, index).filter((type) => type.label.trim() || type.name?.trim()).length}.durationMinutes`;
  const form = useContractForm(groupTarget ? groupEventSettingsUpdateSchema : eventSettingsUpdateSchema, body);
  async function handleSubmit(submitEvent: Event): Promise<void> {
    submitEvent.preventDefault();
    if (!canWrite || !editing || saving) return;
    const checked = form.submit();
    if (!checked.data) {
      setOutcome(checked.formMessage ? { tone: "danger", message: checked.formMessage } : null);
      return;
    }
    setSaving(true);
    setOutcome(null);
    try {
      const changingSlug = section === "general" && slug.trim() !== event.slug;
      if (
        changingSlug &&
        !(await confirmAction({
          title: "Change the event address?",
          consequences: [
            `The event address changes from ${event.slug} to ${slug.trim()}.`,
            "Links using the old event address will stop working. Registration and agenda records stay attached to this event.",
          ],
          confirmLabel: "Change address",
        }))
      )
        return;
      const settings = { ...checked.data, ...(changingSlug ? { confirmSlugChange: true } : {}) };
      if (groupTarget) {
        const response = await patchJson(
          `/api/v1/groups/${encodeURIComponent(groupTarget.groupId)}/events/${encodeURIComponent(groupTarget.eventId)}/settings`,
          settings,
          groupEventDetailResponseSchema,
        );
        await groupTarget.onSaved(response.event.slug);
      } else {
        const response = await patchJson(
          `/api/v1/events/${encodeURIComponent(event.slug)}/settings`,
          settings,
          eventManagementDetailResponseSchema,
        );
        onUpdated(response.event);
      }
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
    setSlug(event.slug);
    setName(event.name ?? "");
    setTimezone(event.timezone ?? "UTC");
    setStartsAt(toLocalDateTime(event.startsAt, event.timezone ?? "UTC"));
    setEndsAt(toLocalDateTime(event.endsAt, event.timezone ?? "UTC"));
    setVenue(event.venue ?? "");
    setHeroImageUrl(event.heroImageUrl ?? "");
    setCity(event.city ?? "");
    setCountry(event.country ?? "");
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
        section={section}
        canEdit={canWrite}
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

  const editActions = (
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

          {(section === "general" || section === "location") && (
            <Panel>
              <PanelHeader title={section === "location" ? "Schedule and location" : "Event details"} headingLevel={2}>
                {editActions}
              </PanelHeader>
              <PanelBody class="pk-stack">
                {section === "general" && (
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
                    <Field {...form.of("slug")} label="Slug" required>
                      {(control) => (
                        <TextInput
                          {...control}
                          name="slug"
                          class="pk-mono"
                          value={slug}
                          onInput={(inputEvent) => setSlug((inputEvent.target as HTMLInputElement).value)}
                        />
                      )}
                    </Field>
                  </div>
                )}

                {section === "location" && (
                  <>
                    <EventPlaceFields
                      fields={form.of}
                      city={city}
                      country={country}
                      timezone={timezone}
                      onCityChange={setCity}
                      onCountryChange={setCountry}
                      onTimezoneChange={setTimezone}
                    />

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
                            placeholder="Meervaart, Meer en Vaart 300, 1068 LE Amsterdam"
                            onInput={(inputEvent) => setVenue((inputEvent.target as HTMLInputElement).value)}
                          />
                        )}
                      </Field>
                    </div>
                  </>
                )}
                {section === "general" && (
                  <div class="pk-grid">
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
                  </div>
                )}
              </PanelBody>
            </Panel>
          )}

          {section === "session-types" && (
            <Panel>
              <PanelHeader title="Session types" headingLevel={2}>
                {editActions}
              </PanelHeader>
              <PanelBody class="pk-stack">
                <SessionTypeEditor
                  sessionTypes={sessionTypes}
                  savedSessionTypes={event.sessionTypes}
                  fieldFor={form.of}
                  durationPath={sessionTypeDurationPath}
                  onChange={setSessionTypes}
                />
              </PanelBody>
            </Panel>
          )}

          {section === "registration" && (
            <Panel>
              <PanelHeader title="Visibility and registration" headingLevel={2}>
                {editActions}
              </PanelHeader>
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
                            setMode(
                              (changeEvent.target as HTMLSelectElement).value as EventDetail["registrationPolicy"],
                            )
                          }
                        >
                          {/* The policies and their words both come from the
                            contract, the way the visibility field above
                            already reads them. */}
                          {STANDALONE_EVENT_REGISTRATION_POLICIES.map((policy) => (
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
                  {event.sourceMode !== "portal" && (
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
                  )}
                </div>
              </PanelBody>
            </Panel>
          )}
        </fieldset>

        {outcome && <Alert tone={outcome.tone}>{outcome.message}</Alert>}
      </form>
    </div>
  );
}
