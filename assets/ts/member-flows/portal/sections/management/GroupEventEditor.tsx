import { useEffect, useRef, useState } from "preact/hooks";
import {
  EVENT_VISIBILITIES,
  EVENT_VISIBILITY_LABELS,
  standaloneEventProfileKeySchema,
  type EventRegistrationPolicy,
  type StandaloneEventProfileKey,
  type EventVisibility,
} from "../../../../../shared/schemas/event-series";
import {
  eventProfileCatalogResponseSchema,
  type EventProfileCatalogItem,
} from "../../../../../shared/schemas/event-management";
import {
  groupEventCreateSchema,
  groupEventDetailResponseSchema,
  groupEventSettingsUpdateSchema,
  type GroupEvent,
} from "../../../../../shared/schemas/group-events";
import { ProfileLinksInput } from "../../../../components/ProfileLinksInput";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { EventScheduleFields } from "../../../../components/EventScheduleFields";
import { FormActions } from "../../../../components/FormActions";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson, patchJson } from "../../../../shared/api-client";
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";
import { isoDateTimeValue } from "./meeting-form-utils";
// `pk-mono` on the slug control is defined in Content.css, which ships in a
// lazy chunk rather than in the entry stylesheet. A surface that writes the
// class without importing the sheet renders it unstyled.
import "../../../../ui/Content.css";

interface EventDraft {
  name: string;
  slug: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  profileKey: StandaloneEventProfileKey;
  registrationPolicy: EventRegistrationPolicy;
  visibility: EventVisibility;
  inviteLimitAttendee: number;
  location: string;
  links: string[];
}

function localDateTime(value: string | null, timeZone: string): string {
  if (!value) return "";
  try {
    const date = new Date(value);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
  } catch {
    return "";
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function initialDraft(event: GroupEvent | null): EventDraft {
  const timezone = event?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const profileKey = standaloneEventProfileKeySchema.safeParse(event?.profileKey).data ?? "workshop";
  return {
    name: event?.name ?? "",
    slug: event?.slug ?? "",
    timezone,
    startsAt: localDateTime(event?.startsAt ?? null, timezone),
    endsAt: localDateTime(event?.endsAt ?? null, timezone),
    profileKey,
    registrationPolicy: event?.registrationPolicy ?? "no_registration",
    visibility: event?.visibility ?? "group_members",
    inviteLimitAttendee: event?.inviteLimitAttendee ?? 5,
    location: event?.location ?? "",
    links: event?.links ?? [],
  };
}

function fieldValue(value: string): string | null {
  return value.trim() || null;
}

export function GroupEventEditor({
  groupId,
  event,
  onSaved,
  onCancel,
}: {
  groupId: string;
  event: GroupEvent | null;
  onSaved: (event: GroupEvent) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(() => initialDraft(event));
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const eventRevision = `${groupId}:${event?.id ?? "new"}:${event?.updatedAt ?? ""}`;
  const renderedEventRevision = useRef(eventRevision);
  const isCreate = event === null;
  const profileCatalog = useData(
    () =>
      isCreate
        ? getJson(`/api/v1/groups/${encodeURIComponent(groupId)}/events/profiles`, eventProfileCatalogResponseSchema)
        : Promise.resolve({ profiles: [] as EventProfileCatalogItem[] }),
    [groupId, isCreate],
  );
  const availableProfiles = (profileCatalog.data?.profiles ?? []).filter(
    (profile) => profile.standaloneEligible && standaloneEventProfileKeySchema.safeParse(profile.key).success,
  );

  useEffect(() => {
    if (!isCreate || availableProfiles.length === 0) return;
    if (!availableProfiles.some((profile) => profile.key === draft.profileKey)) {
      const firstProfile = standaloneEventProfileKeySchema.parse(availableProfiles[0].key);
      setDraft((current) => ({ ...current, profileKey: firstProfile }));
    }
  }, [isCreate, profileCatalog.data]);

  useEffect(() => {
    if (renderedEventRevision.current === eventRevision) return;
    renderedEventRevision.current = eventRevision;
    setDraft(initialDraft(event));
    setError(null);
    setStatus("");
  }, [eventRevision]);

  function update<Key extends keyof EventDraft>(key: Key, value: EventDraft[Key]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function handleName(value: string): void {
    setDraft((current) => ({
      ...current,
      name: value,
      slug: isCreate && (!current.slug || current.slug === slugify(current.name)) ? slugify(value) : current.slug,
    }));
  }

  async function save(submitEvent: Event): Promise<void> {
    submitEvent.preventDefault();
    setSaving(true);
    setError(null);
    setStatus("Saving…");
    try {
      const startsAt = fieldValue(draft.startsAt) ? isoDateTimeValue(draft.startsAt, draft.timezone) : null;
      const endsAt = fieldValue(draft.endsAt) ? isoDateTimeValue(draft.endsAt, draft.timezone) : null;
      if (isCreate) {
        const input = groupEventCreateSchema.parse({
          slug: draft.slug,
          name: draft.name,
          timezone: draft.timezone,
          startsAt,
          endsAt,
          profileKey: standaloneEventProfileKeySchema.parse(draft.profileKey),
          registrationPolicy: "no_registration",
          visibility: draft.visibility,
          inviteLimitAttendee: draft.inviteLimitAttendee,
          location: fieldValue(draft.location),
          links: draft.links,
        });
        const response = await postJson(
          `/api/v1/groups/${encodeURIComponent(groupId)}/events`,
          input,
          groupEventDetailResponseSchema,
        );
        setStatus("Event created");
        await onSaved(response.event);
        return;
      }

      const input = groupEventSettingsUpdateSchema.parse({
        expectedUpdatedAt: event.updatedAt,
        name: draft.name,
        timezone: draft.timezone,
        startsAt,
        endsAt,
        inviteLimitAttendee: draft.inviteLimitAttendee,
        visibility: draft.visibility,
        location: fieldValue(draft.location),
        links: draft.links,
      });
      const response = await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/settings`,
        input,
        groupEventDetailResponseSchema,
      );
      setStatus("Event updated");
      await onSaved(response.event);
    } catch (cause) {
      setStatus("");
      setError(cause instanceof Error ? cause.message : "Could not save this event.");
    } finally {
      setSaving(false);
    }
  }

  const selectedProfile = availableProfiles.find((profile) => profile.key === draft.profileKey);
  // The catalog is only fetched when creating, so "nothing to choose from" is a
  // create-time condition. It blocks submission, which is what makes it the
  // Field's `invalid` state rather than advisory guidance: the message is
  // announced, and the select carries `aria-invalid` to say why the form
  // cannot be sent.
  const noProfilesAvailable =
    isCreate && !profileCatalog.loading && profileCatalog.error === null && availableProfiles.length === 0;
  const profileHelp =
    isCreate && profileCatalog.loading
      ? "Loading available event profiles…"
      : (selectedProfile?.description ?? undefined);

  return (
    <form class="pk pk-stack" onSubmit={(event) => void save(event)}>
      {error && <ErrorAlert error={error} />}
      {isCreate && profileCatalog.error && <ErrorAlert error={profileCatalog.error} />}

      {/* One attribute takes the whole form out of play while it saves,
          including the link editor's own controls, which take no prop for it.
          The submit and cancel pair stays outside so it keeps focus. */}
      <fieldset class="pk-fieldset pk-stack" disabled={saving}>
        <div class="pk-grid pk-grid--roomy">
          <Field label="Event name" required>
            {(control) => (
              <TextInput
                {...control}
                value={draft.name}
                onInput={(inputEvent) => handleName((inputEvent.target as HTMLInputElement).value)}
              />
            )}
          </Field>

          {/* Once the event exists its address is fixed, so the control is
              locked and says so in words rather than only looking greyed out —
              and it drops the required marker, which would be asking for
              something the reader cannot give. */}
          <Field
            label="Slug"
            required={isCreate}
            help={
              isCreate
                ? "Used in the event's address. Lower case, words joined by hyphens."
                : "The address is fixed once the event exists."
            }
          >
            {(control) => (
              <TextInput
                {...control}
                class="pk-mono"
                value={draft.slug}
                disabled={!isCreate}
                onInput={(inputEvent) => update("slug", (inputEvent.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        </div>

        <EventScheduleFields
          idPrefix={`group-event-${event?.id ?? "new"}`}
          startsAt={draft.startsAt}
          endsAt={draft.endsAt}
          timezone={draft.timezone}
          onStartsAtChange={(value) => update("startsAt", value)}
          onEndsAtChange={(value) => update("endsAt", value)}
          onTimezoneChange={(value) => update("timezone", value)}
        />

        <div class="pk-grid pk-grid--roomy">
          <Field
            label="Event profile"
            help={profileHelp}
            state={noProfilesAvailable ? "invalid" : undefined}
            message={noProfilesAvailable ? "No standalone event profiles are currently available." : undefined}
          >
            {(control) => (
              <Select
                {...control}
                value={draft.profileKey}
                disabled={!isCreate || profileCatalog.loading || availableProfiles.length === 0}
                onChange={(inputEvent) =>
                  update(
                    "profileKey",
                    standaloneEventProfileKeySchema.parse((inputEvent.target as HTMLSelectElement).value),
                  )
                }
              >
                {availableProfiles.map((profile) => (
                  <option key={profile.key} value={profile.key}>
                    {profile.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          {!isCreate && (
            <Field label="Registration" help="Changed from the registration setup, not from here.">
              {(control) => <TextInput {...control} value={draft.registrationPolicy.replaceAll("_", " ")} readOnly />}
            </Field>
          )}

          <Field label="Visibility">
            {(control) => (
              <Select
                {...control}
                value={draft.visibility}
                onChange={(inputEvent) =>
                  update("visibility", (inputEvent.target as HTMLSelectElement).value as EventVisibility)
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

          <Field label="Location">
            {(control) => (
              <TextInput
                {...control}
                value={draft.location}
                onInput={(inputEvent) => update("location", (inputEvent.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Peer invitation limit"
          help="Maximum number of attendee invitations each registered participant may send. Set this to 0 to disable peer invitations. Manager invitations are configured separately."
        >
          {(control) => (
            <TextInput
              {...control}
              type="number"
              min={0}
              max={50}
              value={draft.inviteLimitAttendee}
              onInput={(inputEvent) =>
                update("inviteLimitAttendee", Number((inputEvent.target as HTMLInputElement).value))
              }
            />
          )}
        </Field>

        {/* The link editor is several controls, not one, so the group is named
            by a legend rather than by a label with nothing to point at. Its own
            input keeps its own accessible name. */}
        <fieldset class="pk-fieldset pk-stack pk-stack--tight">
          <legend class="pk-field__label">Links</legend>
          <ProfileLinksInput
            fieldName={`group-event-links-${event?.id ?? "new"}`}
            value={draft.links}
            onChange={(links) => update("links", links)}
            helpText="Add the event website, agenda, repository, or other relevant resources."
            inputAriaLabel="Event resource URL"
          />
        </fieldset>
      </fieldset>

      <FormActions
        submitLabel={isCreate ? "Create event" : "Save event"}
        busyLabel={isCreate ? "Creating…" : "Saving…"}
        busy={saving}
        onCancel={onCancel ?? (() => undefined)}
        status={status}
        disabled={
          saving ||
          (isCreate && (profileCatalog.loading || profileCatalog.error !== null || availableProfiles.length === 0))
        }
      />
    </form>
  );
}
