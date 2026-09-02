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
import { Field } from "../../../../ui/Field";
import { Select, TextInput } from "../../../../ui/TextControl";

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

/**
 * The fields describing a recurring meeting series, shared by the create form
 * and the settings form.
 *
 * The three groups are the three decisions: what the meeting is, when it
 * recurs, and who may attend. They are separate `pk-grid` blocks rather than
 * one twelve-column row, so the columns reflow by how much room a field needs
 * instead of by a breakpoint triplet written per field.
 *
 * Every control is inside a `Field`, which pairs the label and the control by
 * generated id — the recurrence editor's fields and the time-zone input
 * included — so no id here is the component's to choose.
 */
export function MeetingSeriesFields({
  draft,
  disabled = false,
  scheduleLocked = false,
  onChange,
}: {
  draft: MeetingSeriesDraft;
  disabled?: boolean;
  scheduleLocked?: boolean;
  onChange: (draft: MeetingSeriesDraft) => void;
}) {
  const scheduleDisabled = disabled || scheduleLocked;

  return (
    <div class="pk pk-stack">
      <div class="pk-grid">
        <Field label="Meeting name" required>
          {(control) => (
            <TextInput
              {...control}
              value={draft.name}
              disabled={disabled}
              onInput={(event) => updateDraft(draft, onChange, "name", event.currentTarget.value)}
            />
          )}
        </Field>
        <Field label="Event profile">
          {(control) => (
            <Select
              {...control}
              value={draft.profileKey}
              disabled={disabled}
              onChange={(event) =>
                updateDraft(draft, onChange, "profileKey", event.currentTarget.value as EventProfileKey)
              }
            >
              {EVENT_PROFILE_KEYS.map((profile) => (
                <option key={profile} value={profile}>
                  {EVENT_PROFILE_LABELS[profile]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="First occurrence" required>
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={draft.startsAt}
              disabled={scheduleDisabled}
              onInput={(event) => updateDraft(draft, onChange, "startsAt", event.currentTarget.value)}
            />
          )}
        </Field>
      </div>

      <div class="pk-grid pk-grid--roomy">
        <RecurrenceEditor
          value={draft.recurrenceRule}
          disabled={scheduleDisabled}
          referenceDate={draft.startsAt}
          onChange={(value) => updateDraft(draft, onChange, "recurrenceRule", value)}
        />
        <Field label="Time zone" required>
          {(control) => (
            <TimeZoneSelect
              {...control}
              value={draft.timezone}
              disabled={scheduleDisabled}
              onChange={(value) => updateDraft(draft, onChange, "timezone", value)}
            />
          )}
        </Field>
        <Field label="Duration (minutes)" required>
          {(control) => (
            <TextInput
              {...control}
              type="number"
              min={1}
              max={10080}
              value={draft.durationMinutes}
              disabled={scheduleDisabled}
              onInput={(event) => updateDraft(draft, onChange, "durationMinutes", Number(event.currentTarget.value))}
            />
          )}
        </Field>
      </div>

      <div class="pk-grid">
        <Field label="Registration">
          {(control) => (
            <Select
              {...control}
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
            </Select>
          )}
        </Field>
        <Field label="Visibility">
          {(control) => (
            <Select
              {...control}
              value={draft.visibility}
              disabled={disabled}
              onChange={(event) =>
                updateDraft(draft, onChange, "visibility", event.currentTarget.value as EventVisibility)
              }
            >
              {EVENT_VISIBILITIES.map((visibility) => (
                <option key={visibility} value={visibility}>
                  {EVENT_VISIBILITY_LABELS[visibility]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Attendee eligibility">
          {(control) => (
            <Select
              {...control}
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
            </Select>
          )}
        </Field>
        <Field label="External guests">
          {(control) => (
            <Select
              {...control}
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
            </Select>
          )}
        </Field>
      </div>

      <Field label="Location or public meeting page">
        {(control) => (
          <TextInput
            {...control}
            value={draft.location}
            disabled={disabled}
            onInput={(event) => updateDraft(draft, onChange, "location", event.currentTarget.value)}
          />
        )}
      </Field>
    </div>
  );
}
