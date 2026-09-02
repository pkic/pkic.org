import { useState } from "preact/hooks";
import { eventSeriesCreateSchema, eventSeriesResponseSchema } from "../../../../../shared/schemas/event-series";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { ApiClientError, postJson } from "../../../../shared/api-client";
import { HashRedirect } from "../../HashRedirect";
import { usePortalHashLocation } from "../../hash-location";
import { GroupMeetingSeriesList } from "./GroupMeetingSeriesList";
import { GroupMeetingSeriesRecord } from "./GroupMeetingSeriesRecord";
import { MeetingSeriesFields, type MeetingSeriesDraft } from "./MeetingSeriesFields";
import { isoDateTimeValue, localDateTimeValue } from "./meeting-form-utils";

/** Reserved series segment that routes to the creation page instead of a series' record. */
const NEW_MEETING_SERIES_SEGMENT = "new";

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

function CreateMeetingSeries({
  groupId,
  onCreated,
  onCancel,
}: {
  groupId: string;
  onCreated: (createdSeriesId: string) => void;
  onCancel: () => void;
}) {
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
      const created = await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`,
        input,
        eventSeriesResponseSchema,
      );
      onCreated(created.series.id);
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
    <Panel aria-label="Schedule a recurring meeting">
      <PanelHeader title="Schedule a recurring meeting">
        <Button size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </PanelHeader>
      <PanelBody>
        <form class="pk-stack" onSubmit={(event) => void submit(event)}>
          <p class="pk-small">
            Configure attendance eligibility, registration, and guest access once for the recurring series.
          </p>
          {error && <ErrorAlert error={error} />}
          <MeetingSeriesFields
            idPrefix="managed-group-meeting-create"
            draft={draft}
            disabled={saving}
            onChange={setDraft}
          />
          <div class="pk-cluster">
            {/* `loading` announces the save through aria-busy and shows the
                spinner; `disabled` is what actually stops a second submit. */}
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              {saving ? "Creating…" : "Create meeting series"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}

export function GroupMeetings({
  groupId,
  canManage,
  seriesSegment,
  seriesTab,
}: {
  groupId: string;
  canManage: boolean;
  /** `undefined` for the list, `"new"` for the create page, or a series id for its record. */
  seriesSegment?: string;
  /** The URL-addressed tab segment below a series id. */
  seriesTab?: string;
}) {
  const [, navigate] = usePortalHashLocation();
  const meetingsPath = `/groups/${encodeURIComponent(groupId)}/meetings`;

  function leaveToList(): void {
    navigate(meetingsPath);
  }

  if (seriesSegment === NEW_MEETING_SERIES_SEGMENT) {
    if (!canManage) return <HashRedirect to={meetingsPath} />;
    return (
      // Creation is a page of its own: a way back, and the create form —
      // which names what is being created in its own heading — alone on the
      // screen rather than layered over the list.
      <div class="pk pk-stack">
        <div class="pk-cluster">
          <Button variant="link" size="sm" onClick={leaveToList}>
            ← All meeting series
          </Button>
        </div>
        <CreateMeetingSeries
          groupId={groupId}
          onCreated={(createdSeriesId) => navigate(`${meetingsPath}/${encodeURIComponent(createdSeriesId)}`)}
          onCancel={leaveToList}
        />
      </div>
    );
  }

  if (seriesSegment) {
    // A series is a record with facets — occurrences, settings — so it gets
    // its own page rather than an expansion between the list's rows.
    return (
      <GroupMeetingSeriesRecord
        groupId={groupId}
        seriesId={seriesSegment}
        initialTab={seriesTab}
        onLeave={leaveToList}
      />
    );
  }

  return (
    // The list is its own panel — head, table, pager inside one frame.
    <div class="pk">
      <GroupMeetingSeriesList
        groupId={groupId}
        createAction={
          canManage
            ? { label: "New series", onSelect: () => navigate(`${meetingsPath}/${NEW_MEETING_SERIES_SEGMENT}`) }
            : undefined
        }
      />
    </div>
  );
}
