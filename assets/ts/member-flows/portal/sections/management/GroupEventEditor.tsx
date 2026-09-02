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
import { useContractForm } from "../../../../hooks/useContractForm";
import { useData } from "../../../../hooks/useData";
import { getJson, postJson, patchJson } from "../../../../shared/api-client";
import { Alert } from "../../../../ui/Alert";
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

/** The schedule as the instants the contract carries. */
interface ScheduleInstants {
  startsAt: string | null;
  endsAt: string | null;
  /** The shared codec's reason when a wall clock cannot be placed in the zone. */
  problem: string | null;
}

/**
 * Converts the draft's wall clocks through the shared time-zone codec. A
 * value the codec refuses — a DST gap, an unknown zone — is passed through as
 * typed so the contract refuses it too and nothing is sent; the codec's own
 * reason is kept for the form to state.
 */
function scheduleInstants(draft: EventDraft): ScheduleInstants {
  let problem: string | null = null;
  const place = (value: string): string | null => {
    if (!fieldValue(value)) return null;
    try {
      return isoDateTimeValue(value, draft.timezone);
    } catch (cause) {
      problem ??= cause instanceof Error ? cause.message : "Enter a valid date and time";
      return value;
    }
  };
  return { startsAt: place(draft.startsAt), endsAt: place(draft.endsAt), problem };
}

/** The create body, as the group event create contract reads it. */
function createPayload(draft: EventDraft, schedule: ScheduleInstants) {
  return {
    slug: draft.slug,
    name: draft.name,
    timezone: draft.timezone,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    profileKey: draft.profileKey,
    registrationPolicy: "no_registration",
    visibility: draft.visibility,
    inviteLimitAttendee: draft.inviteLimitAttendee,
    location: fieldValue(draft.location),
    links: draft.links,
  };
}

/** The settings body, as the group event settings contract reads it. */
function settingsPayload(draft: EventDraft, schedule: ScheduleInstants, event: GroupEvent) {
  return {
    expectedUpdatedAt: event.updatedAt,
    name: draft.name,
    timezone: draft.timezone,
    startsAt: schedule.startsAt,
    endsAt: schedule.endsAt,
    inviteLimitAttendee: draft.inviteLimitAttendee,
    visibility: draft.visibility,
    location: fieldValue(draft.location),
    links: draft.links,
  };
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
  // One basis for validation: the contract the route parses — create or
  // settings — decides what each field shows, live, and what Save may send.
  const schedule = scheduleInstants(draft);
  const form = useContractForm(
    isCreate ? groupEventCreateSchema : groupEventSettingsUpdateSchema,
    isCreate ? createPayload(draft, schedule) : settingsPayload(draft, schedule, event),
  );
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
    form.reset();
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
    // Nothing leaves the page until the contract accepts the whole draft. A
    // wall clock the zone cannot place is stated in the codec's own words.
    const checked = form.submit();
    if (!checked.data) {
      setStatus("");
      setError(schedule.problem ?? checked.message);
      return;
    }
    setSaving(true);
    setError(null);
    setStatus("Saving…");
    try {
      if (isCreate) {
        const response = await postJson(
          `/api/v1/groups/${encodeURIComponent(groupId)}/events`,
          checked.data,
          groupEventDetailResponseSchema,
        );
        setStatus("Event created");
        await onSaved(response.event);
        return;
      }

      const response = await patchJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/events/${encodeURIComponent(event.id)}/settings`,
        checked.data,
        groupEventDetailResponseSchema,
      );
      setStatus("Event updated");
      await onSaved(response.event);
    } catch (cause) {
      setStatus("");
      // A server refusal names its fields the same way the contract does.
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  const selectedProfile = availableProfiles.find((profile) => profile.key === draft.profileKey);
  // The catalog is only fetched when creating, so "nothing to choose from" is a
  // create-time condition. It is not the contract's verdict on a value, so it
  // is stated as an alert beside the form it blocks rather than as a field
  // state; Create stays disabled until a profile can be chosen.
  const noProfilesAvailable =
    isCreate && !profileCatalog.loading && profileCatalog.error === null && availableProfiles.length === 0;
  const profileHelp =
    isCreate && profileCatalog.loading
      ? "Loading available event profiles…"
      : (selectedProfile?.description ?? undefined);

  return (
    <form noValidate class="pk pk-stack" onSubmit={(event) => void save(event)} {...form.handlers}>
      {error && <ErrorAlert error={error} />}
      {isCreate && profileCatalog.error && <ErrorAlert error={profileCatalog.error} />}
      {noProfilesAvailable && <Alert tone="warn">No standalone event profiles are currently available.</Alert>}

      {/* One attribute takes the whole form out of play while it saves,
          including the link editor's own controls, which take no prop for it.
          The submit and cancel pair stays outside so it keeps focus. */}
      <fieldset class="pk-fieldset pk-stack" disabled={saving}>
        <div class="pk-grid pk-grid--roomy">
          <Field label="Event name" required {...form.of("name")}>
            {(control) => (
              <TextInput
                {...control}
                name="name"
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
            {...form.of("slug")}
          >
            {(control) => (
              <TextInput
                {...control}
                name="slug"
                class="pk-mono"
                value={draft.slug}
                disabled={!isCreate}
                onInput={(inputEvent) => update("slug", (inputEvent.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        </div>

        <EventScheduleFields
          startsAt={draft.startsAt}
          endsAt={draft.endsAt}
          timezone={draft.timezone}
          onStartsAtChange={(value) => update("startsAt", value)}
          onEndsAtChange={(value) => update("endsAt", value)}
          onTimezoneChange={(value) => update("timezone", value)}
        />

        <div class="pk-grid pk-grid--roomy">
          <Field label="Event profile" help={profileHelp} {...form.of("profileKey")}>
            {(control) => (
              <Select
                {...control}
                name="profileKey"
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

          <Field label="Visibility" {...form.of("visibility")}>
            {(control) => (
              <Select
                {...control}
                name="visibility"
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

          <Field label="Location" {...form.of("location")}>
            {(control) => (
              <TextInput
                {...control}
                name="location"
                value={draft.location}
                onInput={(inputEvent) => update("location", (inputEvent.target as HTMLInputElement).value)}
              />
            )}
          </Field>
        </div>

        <Field
          label="Peer invitation limit"
          help="Maximum number of attendee invitations each registered participant may send. Set this to 0 to disable peer invitations. Manager invitations are configured separately."
          {...form.of("inviteLimitAttendee")}
        >
          {(control) => (
            <TextInput
              {...control}
              name="inviteLimitAttendee"
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
        <fieldset class="pk-fieldset pk-field">
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
