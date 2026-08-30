import {
  EVENT_GUEST_POLICIES,
  EVENT_MEMBER_ELIGIBILITIES,
  EVENT_PROFILE_LABELS,
  EVENT_PROFILE_KEYS,
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_REGISTRATION_POLICIES,
  EVENT_VISIBILITIES,
  EVENT_VISIBILITY_LABELS,
  type EventGuestPolicy,
  type EventMemberEligibility,
  type EventProfileKey,
  type EventRegistrationPolicy,
  type EventVisibility,
} from "../../../../../shared/schemas/event-series";
import { RecurrenceEditor } from "../../../../components/RecurrenceEditor";
import { TimeZoneSelect } from "../../../../components/TimeZoneSelect";

export interface MeetingSeriesDraft {
  name: string;
  profileKey: EventProfileKey;
  startsAt: string;
  recurrenceRule: string;
  timezone: string;
  durationMinutes: number;
  location: string;
  registrationPolicy: EventRegistrationPolicy;
  visibility: EventVisibility;
  memberEligibility: EventMemberEligibility;
  guestPolicy: EventGuestPolicy;
}

const ELIGIBILITY_LABELS: Record<EventMemberEligibility, string> = {
  owner_group: "Owning group",
  shared_groups: "Owning and explicitly shared groups",
  public: "Public",
};

const GUEST_LABELS: Record<EventGuestPolicy, string> = {
  none: "Not allowed",
  occurrence_invitation: "Invite per occurrence",
  public_registration: "Public registration",
};

function updateDraft<K extends keyof MeetingSeriesDraft>(
  draft: MeetingSeriesDraft,
  onChange: (draft: MeetingSeriesDraft) => void,
  key: K,
  value: MeetingSeriesDraft[K],
): void {
  onChange({ ...draft, [key]: value });
}

export function MeetingSeriesFields({
  idPrefix,
  draft,
  disabled = false,
  scheduleLocked = false,
  onChange,
}: {
  idPrefix: string;
  draft: MeetingSeriesDraft;
  disabled?: boolean;
  scheduleLocked?: boolean;
  onChange: (draft: MeetingSeriesDraft) => void;
}) {
  return (
    <div class="row g-3">
      <div class="col-md-6">
        <label class="form-label small fw-semibold" for={`${idPrefix}-name`}>
          Meeting name
        </label>
        <input
          id={`${idPrefix}-name`}
          class="form-control"
          value={draft.name}
          required
          disabled={disabled}
          onInput={(event) => updateDraft(draft, onChange, "name", event.currentTarget.value)}
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-semibold" for={`${idPrefix}-profile`}>
          Event profile
        </label>
        <select
          id={`${idPrefix}-profile`}
          class="form-select"
          value={draft.profileKey}
          disabled={disabled}
          onChange={(event) => updateDraft(draft, onChange, "profileKey", event.currentTarget.value as EventProfileKey)}
        >
          {EVENT_PROFILE_KEYS.map((profile) => (
            <option key={profile} value={profile}>
              {EVENT_PROFILE_LABELS[profile]}
            </option>
          ))}
        </select>
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-semibold" for={`${idPrefix}-start`}>
          First occurrence
        </label>
        <input
          id={`${idPrefix}-start`}
          type="datetime-local"
          class="form-control"
          value={draft.startsAt}
          required
          disabled={disabled || scheduleLocked}
          onInput={(event) => updateDraft(draft, onChange, "startsAt", event.currentTarget.value)}
        />
      </div>
      <div class="col-md-6">
        <RecurrenceEditor
          id={`${idPrefix}-recurrence`}
          value={draft.recurrenceRule}
          disabled={disabled || scheduleLocked}
          referenceDate={draft.startsAt}
          onChange={(value) => updateDraft(draft, onChange, "recurrenceRule", value)}
        />
      </div>
      <div class="col-md-3">
        <TimeZoneSelect
          id={`${idPrefix}-timezone`}
          label="Time zone"
          value={draft.timezone}
          disabled={disabled || scheduleLocked}
          onChange={(value) => updateDraft(draft, onChange, "timezone", value)}
        />
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-semibold" for={`${idPrefix}-duration`}>
          Duration (minutes)
        </label>
        <input
          id={`${idPrefix}-duration`}
          type="number"
          class="form-control"
          min={1}
          max={10080}
          value={draft.durationMinutes}
          required
          disabled={disabled || scheduleLocked}
          onInput={(event) => updateDraft(draft, onChange, "durationMinutes", Number(event.currentTarget.value))}
        />
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold" for={`${idPrefix}-registration`}>
          Registration
        </label>
        <select
          id={`${idPrefix}-registration`}
          class="form-select"
          value={draft.registrationPolicy}
          disabled={disabled}
          onChange={(event) =>
            updateDraft(draft, onChange, "registrationPolicy", event.currentTarget.value as EventRegistrationPolicy)
          }
        >
          {EVENT_REGISTRATION_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {EVENT_REGISTRATION_POLICY_LABELS[policy]}
            </option>
          ))}
        </select>
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold" for={`${idPrefix}-visibility`}>
          Visibility
        </label>
        <select
          id={`${idPrefix}-visibility`}
          class="form-select"
          value={draft.visibility}
          disabled={disabled}
          onChange={(event) => updateDraft(draft, onChange, "visibility", event.currentTarget.value as EventVisibility)}
        >
          {EVENT_VISIBILITIES.map((visibility) => (
            <option key={visibility} value={visibility}>
              {EVENT_VISIBILITY_LABELS[visibility]}
            </option>
          ))}
        </select>
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold" for={`${idPrefix}-eligibility`}>
          Attendee eligibility
        </label>
        <select
          id={`${idPrefix}-eligibility`}
          class="form-select"
          value={draft.memberEligibility}
          disabled={disabled}
          onChange={(event) =>
            updateDraft(draft, onChange, "memberEligibility", event.currentTarget.value as EventMemberEligibility)
          }
        >
          {EVENT_MEMBER_ELIGIBILITIES.map((eligibility) => (
            <option key={eligibility} value={eligibility}>
              {ELIGIBILITY_LABELS[eligibility]}
            </option>
          ))}
        </select>
      </div>
      <div class="col-md-4">
        <label class="form-label small fw-semibold" for={`${idPrefix}-guests`}>
          External guests
        </label>
        <select
          id={`${idPrefix}-guests`}
          class="form-select"
          value={draft.guestPolicy}
          disabled={disabled}
          onChange={(event) =>
            updateDraft(draft, onChange, "guestPolicy", event.currentTarget.value as EventGuestPolicy)
          }
        >
          {EVENT_GUEST_POLICIES.map((policy) => (
            <option key={policy} value={policy}>
              {GUEST_LABELS[policy]}
            </option>
          ))}
        </select>
      </div>
      <div class="col-12">
        <label class="form-label small fw-semibold" for={`${idPrefix}-location`}>
          Location or public meeting page
        </label>
        <input
          id={`${idPrefix}-location`}
          class="form-control"
          value={draft.location}
          disabled={disabled}
          onInput={(event) => updateDraft(draft, onChange, "location", event.currentTarget.value)}
        />
      </div>
    </div>
  );
}
