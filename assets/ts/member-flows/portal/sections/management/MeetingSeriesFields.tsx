import {
  EVENT_GUEST_POLICIES,
  EVENT_MEMBER_ELIGIBILITIES,
  EVENT_PROFILE_LABELS,
  EVENT_PROFILE_KEYS,
  EVENT_REGISTRATION_POLICY_LABELS,
  EVENT_REGISTRATION_POLICIES,
  type EventGuestPolicy,
  type EventMemberEligibility,
  type EventProfileKey,
  type EventRegistrationPolicy,
} from "../../../../../shared/schemas/event-series";

export interface MeetingSeriesDraft {
  name: string;
  profileKey: EventProfileKey;
  startsAt: string;
  recurrenceRule: string;
  timezone: string;
  durationMinutes: number;
  location: string;
  registrationPolicy: EventRegistrationPolicy;
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
        <label class="form-label small fw-semibold" for={`${idPrefix}-recurrence`}>
          Recurrence rule
        </label>
        <input
          id={`${idPrefix}-recurrence`}
          class="form-control font-monospace"
          value={draft.recurrenceRule}
          required
          disabled={disabled || scheduleLocked}
          list={`${idPrefix}-recurrence-presets`}
          aria-describedby={`${idPrefix}-recurrence-help`}
          onInput={(event) => updateDraft(draft, onChange, "recurrenceRule", event.currentTarget.value)}
        />
        <datalist id={`${idPrefix}-recurrence-presets`}>
          <option value="FREQ=WEEKLY;INTERVAL=1">Weekly</option>
          <option value="FREQ=WEEKLY;INTERVAL=2">Every two weeks</option>
          <option value="FREQ=MONTHLY;INTERVAL=1">Monthly</option>
        </datalist>
        <div id={`${idPrefix}-recurrence-help`} class="form-text">
          RFC 5545 recurrence rule. Presets are suggestions; other valid recurring schedules are supported.
        </div>
      </div>
      <div class="col-md-3">
        <label class="form-label small fw-semibold" for={`${idPrefix}-timezone`}>
          Time zone
        </label>
        <input
          id={`${idPrefix}-timezone`}
          class="form-control"
          value={draft.timezone}
          required
          disabled={disabled || scheduleLocked}
          onInput={(event) => updateDraft(draft, onChange, "timezone", event.currentTarget.value)}
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
