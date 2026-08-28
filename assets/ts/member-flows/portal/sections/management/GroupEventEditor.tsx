import { useEffect, useRef, useState } from "preact/hooks";
import {
  standaloneEventProfileKeySchema,
  type EventRegistrationPolicy,
  type StandaloneEventProfileKey,
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
import { isoDateTimeValue } from "./meeting-form-utils";

interface EventDraft {
  name: string;
  slug: string;
  timezone: string;
  startsAt: string;
  endsAt: string;
  profileKey: StandaloneEventProfileKey;
  registrationPolicy: EventRegistrationPolicy;
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

  return (
    <form class="d-flex flex-column gap-3" onSubmit={(event) => void save(event)}>
      {error && <ErrorAlert error={error} />}
      {isCreate && profileCatalog.error && <ErrorAlert error={profileCatalog.error} />}
      <div class="row g-3">
        <div class="col-md-8">
          <label class="form-label small fw-semibold" for={`group-event-name-${event?.id ?? "new"}`}>
            Event name
          </label>
          <input
            id={`group-event-name-${event?.id ?? "new"}`}
            class="form-control"
            value={draft.name}
            required
            disabled={saving}
            onInput={(inputEvent) => handleName((inputEvent.target as HTMLInputElement).value)}
          />
        </div>
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for={`group-event-slug-${event?.id ?? "new"}`}>
            Slug
          </label>
          <input
            id={`group-event-slug-${event?.id ?? "new"}`}
            class="form-control font-monospace"
            value={draft.slug}
            required
            disabled={saving || !isCreate}
            onInput={(inputEvent) => update("slug", (inputEvent.target as HTMLInputElement).value)}
          />
        </div>
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
      <div class="row g-3">
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for={`group-event-profile-${event?.id ?? "new"}`}>
            Event profile
          </label>
          <select
            id={`group-event-profile-${event?.id ?? "new"}`}
            class="form-select"
            value={draft.profileKey}
            disabled={saving || !isCreate || profileCatalog.loading || availableProfiles.length === 0}
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
          </select>
          {availableProfiles.find((profile) => profile.key === draft.profileKey)?.description && (
            <div class="form-text">
              {availableProfiles.find((profile) => profile.key === draft.profileKey)?.description}
            </div>
          )}
          {isCreate && profileCatalog.loading && <div class="form-text">Loading available event profiles…</div>}
          {isCreate && !profileCatalog.loading && availableProfiles.length === 0 && !profileCatalog.error && (
            <div class="form-text">No standalone event profiles are currently available.</div>
          )}
        </div>
        {!isCreate && (
          <div class="col-md-4">
            <label class="form-label small fw-semibold" for={`group-event-registration-${event?.id ?? "new"}`}>
              Registration
            </label>
            <input
              id={`group-event-registration-${event?.id ?? "new"}`}
              class="form-control"
              value={draft.registrationPolicy.replaceAll("_", " ")}
              readOnly
              disabled={saving}
            />
          </div>
        )}
        <div class="col-md-4">
          <label class="form-label small fw-semibold" for={`group-event-location-${event?.id ?? "new"}`}>
            Location
          </label>
          <input
            id={`group-event-location-${event?.id ?? "new"}`}
            class="form-control"
            value={draft.location}
            disabled={saving}
            onInput={(inputEvent) => update("location", (inputEvent.target as HTMLInputElement).value)}
          />
        </div>
      </div>
      <div>
        <label class="form-label small fw-semibold" for={`group-event-peer-invite-limit-${event?.id ?? "new"}`}>
          Peer invitation limit
        </label>
        <input
          id={`group-event-peer-invite-limit-${event?.id ?? "new"}`}
          class="form-control"
          type="number"
          min="0"
          max="50"
          value={draft.inviteLimitAttendee}
          disabled={saving}
          onInput={(inputEvent) => update("inviteLimitAttendee", Number((inputEvent.target as HTMLInputElement).value))}
        />
        <div class="form-text">
          Maximum number of attendee invitations each registered participant may send. Set this to 0 to disable peer
          invitations. Manager invitations are configured separately.
        </div>
      </div>
      <div>
        <label class="form-label small fw-semibold">Links</label>
        <ProfileLinksInput
          fieldName={`group-event-links-${event?.id ?? "new"}`}
          value={draft.links}
          onChange={(links) => update("links", links)}
          helpText="Add the event website, agenda, repository, or other relevant resources."
          inputAriaLabel="Event resource URL"
        />
      </div>
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
