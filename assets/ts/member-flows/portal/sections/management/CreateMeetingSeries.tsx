import { useState } from "preact/hooks";
import { eventSeriesCreateSchema, eventSeriesResponseSchema } from "../../../../../shared/schemas/event-series";
import { groupEventDetailResponseSchema, type GroupEvent } from "../../../../../shared/schemas/group-events";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import { Spinner } from "../../../../components/Spinner";
import { useContractForm } from "../../../../hooks/useContractForm";
import { useData } from "../../../../hooks/useData";
import { Button } from "../../../../ui/Button";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { getJson, postJson } from "../../../../shared/api-client";
import { MeetingSeriesFields, type MeetingSeriesDraft } from "./MeetingSeriesFields";
import { instantFromLocal } from "../../../../components/forms/SubmissionWindowFields";
import { localDateTimeValue } from "./meeting-form-utils";
import { slugify } from "../../../../../shared/slug";
import { DEFAULT_MEETING_ENTRY_POLICY } from "../../../../../shared/schemas/meeting-entry-policy";

export function CreateMeetingSeries(props: {
  groupId: string;
  existingEventId?: string;
  onCreated: (id: string) => void;
  onCancel: () => void;
}) {
  const existing = useData(
    () =>
      props.existingEventId
        ? getJson(
            `/api/v1/groups/${encodeURIComponent(props.groupId)}/events/${encodeURIComponent(props.existingEventId)}`,
            groupEventDetailResponseSchema,
          )
        : Promise.resolve(null),
    [props.groupId, props.existingEventId],
  );
  if (props.existingEventId && existing.loading) return <Spinner label="Loading meeting…" />;
  if (existing.error) return <ErrorAlert error={existing.error} />;
  return <MeetingSeriesForm key={props.existingEventId ?? "new"} {...props} existingEvent={existing.data?.event} />;
}

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
    providerJoinUrl: "",
    registrationPolicy: "automatic",
    visibility: "group_members",
    memberEligibility: "owner_group",
    guestPolicy: "occurrence_invitation",
    meetingEntryPolicy: DEFAULT_MEETING_ENTRY_POLICY,
  };
}

function MeetingSeriesForm({
  groupId,
  existingEvent,
  onCreated,
  onCancel,
}: {
  groupId: string;
  existingEvent?: GroupEvent;
  onCreated: (createdSeriesId: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    ...initialDraft(),
    ...(existingEvent
      ? {
          name: existingEvent.name,
          profileKey: existingEvent.profileKey ?? "meeting",
          timezone: existingEvent.timezone,
        }
      : {}),
  }));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useContractForm(eventSeriesCreateSchema, {
    existingEventId: existingEvent?.id,
    eventName: draft.name,
    eventSlug: existingEvent?.slug ?? slugify(draft.name),
    profileKey: draft.profileKey,
    policy: {
      registrationPolicy: draft.registrationPolicy,
      visibility: draft.visibility,
      memberEligibility: draft.memberEligibility,
      guestPolicy: draft.guestPolicy,
      meetingEntryPolicy: draft.meetingEntryPolicy,
    },
    startsAt: instantFromLocal(draft.startsAt, draft.timezone),
    recurrenceRule: draft.recurrenceRule,
    timezone: draft.timezone,
    durationMinutes: draft.durationMinutes,
    location: draft.location.trim() || null,
    providerJoinUrl: draft.providerJoinUrl.trim() || null,
    providerType: draft.providerJoinUrl.trim() ? "external_url" : null,
  });

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) return setError(checked.message);
    setSaving(true);
    setError(null);
    try {
      const created = await postJson(
        `/api/v1/groups/${encodeURIComponent(groupId)}/meetings/series`,
        checked.data,
        eventSeriesResponseSchema,
      );
      onCreated(created.series.id);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel aria-label="Schedule a meeting">
      <PanelHeader title="Schedule a meeting" headingLevel={2} breadcrumb>
        <Button size="sm" disabled={saving} onClick={onCancel}>
          Cancel
        </Button>
      </PanelHeader>
      <PanelBody>
        <form class="pk-stack" noValidate {...form.handlers} onSubmit={(event) => void submit(event)}>
          <p class="pk-small">
            A meeting happens once or repeats on a schedule. Attendance eligibility, registration and guest access are
            set once here and apply to every occurrence.
          </p>
          {error && <ErrorAlert error={error} />}
          <MeetingSeriesFields
            draft={draft}
            disabled={saving}
            onChange={setDraft}
            fieldProps={{
              name: form.of("eventName"),
              profileKey: form.of("profileKey"),
              startsAt: form.of("startsAt"),
              timezone: form.of("timezone"),
              durationMinutes: form.of("durationMinutes"),
              location: form.of("location"),
              providerJoinUrl: form.of("providerJoinUrl"),
              recurrenceRule: form.of("recurrenceRule"),
              registrationPolicy: form.of("policy.registrationPolicy"),
              visibility: form.of("policy.visibility"),
              memberEligibility: form.of("policy.memberEligibility"),
              guestPolicy: form.of("policy.guestPolicy"),
              meetingEntryAuthentication: form.of("policy.meetingEntryPolicy.authentication"),
              meetingEntryRememberDays: form.of("policy.meetingEntryPolicy.rememberDays"),
            }}
          />
          <div class="pk-cluster">
            {/* `loading` announces the save through aria-busy and shows the
                spinner; `disabled` is what actually stops a second submit. */}
            <Button type="submit" variant="primary" loading={saving} disabled={saving}>
              {saving ? "Creating…" : "Create meeting"}
            </Button>
          </div>
        </form>
      </PanelBody>
    </Panel>
  );
}
