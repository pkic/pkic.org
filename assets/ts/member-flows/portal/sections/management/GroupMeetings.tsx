import { useRef, useState } from "preact/hooks";
import { eventSeriesCreateSchema, eventSeriesResponseSchema } from "../../../../../shared/schemas/event-series";
import type { ApiTableActions } from "../../../../components/ApiDataTable";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import { GroupMeetingSeriesList } from "./GroupMeetingSeriesList";
import { MeetingSeriesFields, type MeetingSeriesDraft } from "./MeetingSeriesFields";
import { isoDateTimeValue, localDateTimeValue } from "./meeting-form-utils";

function defaultStart(): string {
  const start = new Date();
  start.setDate(start.getDate() + ((8 - start.getDay()) % 7 || 7));
  start.setHours(15, 0, 0, 0);
  return localDateTimeValue(start);
}

function initialDraft(): MeetingSeriesDraft {
  return {
    name: "",
    profileKey: "meeting",
    startsAt: defaultStart(),
    recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    durationMinutes: 60,
    location: "",
    registrationPolicy: "no_registration",
    visibility: "group_members",
    memberEligibility: "owner_group",
    guestPolicy: "occurrence_invitation",
  };
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200);
}

function CreateMeetingSeries({ groupId, onCreated }: { groupId: string; onCreated: () => Promise<void> }) {
  const [draft, setDraft] = useState(initialDraft);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const input = eventSeriesCreateSchema.parse({
        eventName: draft.name,
        eventSlug: slugify(draft.name),
        profileKey: draft.profileKey,
        policy: {
          registrationPolicy: draft.registrationPolicy,
          visibility: draft.visibility,
          memberEligibility: draft.memberEligibility,
          guestPolicy: draft.guestPolicy,
        },
        startsAt: isoDateTimeValue(draft.startsAt, draft.timezone),
        recurrenceRule: draft.recurrenceRule,
        timezone: draft.timezone,
        durationMinutes: draft.durationMinutes,
        location: draft.location.trim() || null,
        providerType: null,
      });
      await postJson(`/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`, input, eventSeriesResponseSchema);
      setDraft(initialDraft());
      await onCreated();
    } catch (cause) {
      setError(
        cause instanceof ApiClientError || cause instanceof Error
          ? cause.message
          : "Could not create the meeting series.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form class="border rounded p-3 d-flex flex-column gap-3" onSubmit={(event) => void submit(event)}>
      <div>
        <h6 class="mb-1">Schedule a recurring meeting</h6>
        <p class="text-muted small mb-0">
          Configure attendance eligibility, registration, and guest access once for the recurring series.
        </p>
      </div>
      {error && <ErrorAlert error={error} />}
      <MeetingSeriesFields
        idPrefix="managed-group-meeting-create"
        draft={draft}
        disabled={saving}
        onChange={setDraft}
      />
      <div>
        <button type="submit" class="btn btn-primary" disabled={saving}>
          {saving ? "Creating…" : "Create meeting series"}
        </button>
      </div>
    </form>
  );
}

export function GroupMeetings({
  groupId,
  canManage,
  initialSeriesId,
}: {
  groupId: string;
  canManage: boolean;
  initialSeriesId?: string;
}) {
  const listActions = useRef<ApiTableActions | null>(null);
  return (
    <div class="card border-0 shadow-sm">
      <div class="card-header bg-white fw-semibold">Meetings</div>
      <div class="card-body d-flex flex-column gap-3">
        <GroupMeetingSeriesList groupId={groupId} actionsRef={listActions} initialSeriesId={initialSeriesId} />
        {canManage && (
          <CreateMeetingSeries groupId={groupId} onCreated={async () => void listActions.current?.reload()} />
        )}
      </div>
    </div>
  );
}
