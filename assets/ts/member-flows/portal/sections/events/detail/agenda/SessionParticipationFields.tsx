import {
  agendaAdmissionPolicySchema,
  agendaOccurrenceCreateSchema,
  type AgendaOccurrence,
} from "../../../../../../../shared/schemas/event-agenda";
import type { FieldPresentation } from "../../../../../../hooks/useContractForm";
import { Field } from "../../../../../../ui/Field";
import { Select, TextInput } from "../../../../../../ui/TextControl";

export interface SessionParticipationDraft {
  policy: AgendaOccurrence["admissionPolicy"];
  accessPolicy: NonNullable<AgendaOccurrence["accessPolicy"]>;
  capacity: string;
  remoteCapacity: string;
  bookingOpensAt: string;
  bookingClosesAt: string;
}

const admissionLabels: Record<AgendaOccurrence["admissionPolicy"], string> = {
  preference: "Preference · first come, first served",
  optional_reservation: "Optional reservation",
  reservation: "Reservation required",
  approval: "Approval required",
};

/** Who may join and how many; live demand belongs to Participation / approvals and event statistics. */
export function SessionParticipationFields({
  draft,
  onChange,
  timeZone,
  of,
  disabled,
}: {
  draft: SessionParticipationDraft;
  onChange: (next: Partial<SessionParticipationDraft>) => void;
  timeZone: string;
  of: (name: string) => FieldPresentation;
  disabled: boolean;
}) {
  return (
    <fieldset disabled={disabled} class="pk-fieldset pk-agenda-editor__form">
      <Field label="Admission" {...of("admissionPolicy")}>
        {(control) => (
          <Select
            {...control}
            name="admissionPolicy"
            value={draft.policy}
            onChange={(event) => onChange({ policy: agendaAdmissionPolicySchema.parse(event.currentTarget.value) })}
          >
            {agendaAdmissionPolicySchema.options.map((value) => (
              <option value={value}>{admissionLabels[value]}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Session access" {...of("accessPolicy")}>
        {(control) => (
          <Select
            {...control}
            name="accessPolicy"
            value={draft.accessPolicy}
            onChange={(event) =>
              onChange({
                accessPolicy: agendaOccurrenceCreateSchema.shape.accessPolicy.unwrap().parse(event.currentTarget.value),
              })
            }
          >
            {agendaOccurrenceCreateSchema.shape.accessPolicy.unwrap().options.map((value) => (
              <option value={value}>{value === "open" ? "Open to registered attendees" : "Invitation only"}</option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Physical session capacity" help="Leave empty to use the location capacity." {...of("capacity")}>
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
      <Field
        label="Remote session capacity"
        help="Leave empty for unlimited remote attendance."
        {...of("remoteCapacity")}
      >
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
      <Field label="Booking opens" help={`Optional; ${timeZone}.`} {...of("bookingOpensAt")}>
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
      <Field label="Booking closes" help={`Optional; ${timeZone}.`} {...of("bookingClosesAt")}>
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
