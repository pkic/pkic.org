import {
  AGENDA_ACCESS_POLICY_LABELS,
  AGENDA_ADMISSION_POLICY_LABELS,
} from "../../../../../../../shared/event-agenda-labels";
import {
  agendaAccessPolicySchema,
  agendaAdmissionPolicySchema,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import { formatClockName } from "../../../../../../../shared/format-date";
import type { ClockZone } from "../../../../../../../shared/event-clock";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";
import { wallClockReadback } from "./wall-clock-readback";

export interface SessionParticipationDraft {
  policy: AgendaOccurrence["admissionPolicy"];
  accessPolicy: NonNullable<AgendaOccurrence["accessPolicy"]>;
  capacity: string;
  remoteCapacity: string;
  bookingOpensAt: string;
  bookingClosesAt: string;
}

/** Who may join and how many; live demand belongs to Participation and approvals and event statistics. */
export function SessionParticipationFields({
  draft,
  onChange,
  timeZone,
  of,
  disabled,
}: {
  draft: SessionParticipationDraft;
  onChange: (next: Partial<SessionParticipationDraft>) => void;
  /** The event's clock, which booking times are entered on. */
  timeZone: ClockZone;
  of: (name: string) => FieldPresentation;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} class="pk-fieldset pk-agenda-editor__form">
      <Field
        label="Admission"
        help={draft.policy === "preference" ? "No seat is reserved." : undefined}
        {...of("admissionPolicy")}
      >
        {(control) => (
          <Select
            {...control}
            name="admissionPolicy"
            value={draft.policy}
            onChange={(event) => onChange({ policy: agendaAdmissionPolicySchema.parse(event.currentTarget.value) })}
          >
            {agendaAdmissionPolicySchema.options.map((value) => (
              <option value={value}>{AGENDA_ADMISSION_POLICY_LABELS[value]}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field
        label="Access"
        help={draft.accessPolicy === "open" ? "Every registered attendee can join." : undefined}
        {...of("accessPolicy")}
      >
        {(control) => (
          <Select
            {...control}
            name="accessPolicy"
            value={draft.accessPolicy}
            onChange={(event) => onChange({ accessPolicy: agendaAccessPolicySchema.parse(event.currentTarget.value) })}
          >
            {agendaAccessPolicySchema.options.map((value) => (
              <option value={value}>{AGENDA_ACCESS_POLICY_LABELS[value]}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="In-person capacity" help="Leave empty to use the location capacity." {...of("capacity")}>
        {(control) => (
          <TextInput
            {...control}
            name="capacity"
            type="number"
            value={draft.capacity}
            onInput={(event) => onChange({ capacity: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field label="Remote capacity" help="Leave empty for unlimited remote attendance." {...of("remoteCapacity")}>
        {(control) => (
          <TextInput
            {...control}
            name="remoteCapacity"
            type="number"
            value={draft.remoteCapacity}
            onInput={(event) => onChange({ remoteCapacity: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field
        label="Booking opens"
        help={wallClockReadback(draft.bookingOpensAt, timeZone) ?? `Optional. ${formatClockName(timeZone)}.`}
        {...of("bookingOpensAt")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="bookingOpensAt"
            type="datetime-local"
            value={draft.bookingOpensAt}
            onInput={(event) => onChange({ bookingOpensAt: event.currentTarget.value })}
          />
        )}
      </Field>
      <Field
        label="Booking closes"
        help={wallClockReadback(draft.bookingClosesAt, timeZone) ?? `Optional. ${formatClockName(timeZone)}.`}
        {...of("bookingClosesAt")}
      >
        {(control) => (
          <TextInput
            {...control}
            name="bookingClosesAt"
            type="datetime-local"
            value={draft.bookingClosesAt}
            onInput={(event) => onChange({ bookingClosesAt: event.currentTarget.value })}
          />
        )}
      </Field>
    </fieldset>
  );
}
