import {
  eventEmailCampaignInvitationStatusFilterSchema,
  type EventEmailCampaignInvitationStatusFilter,
} from "../../../shared/schemas/event-email-campaigns";
import type { FieldPresentation } from "../../hooks/useContractForm";
import { Field } from "../../ui/Field";
import { Select } from "../../ui/TextControl";

const INVITATION_STATUS_LABELS: Record<EventEmailCampaignInvitationStatusFilter, string> = {
  all: "All invited",
  sent: "Open",
  accepted: "Accepted",
  expired: "Expired",
};

export function EventInvitationStatusFilter({
  value,
  onChange,
  field,
}: {
  value: EventEmailCampaignInvitationStatusFilter;
  onChange: (value: EventEmailCampaignInvitationStatusFilter) => void;
  field: FieldPresentation;
}) {
  return (
    <div class="pk-stack">
      <Field label="Invitation status" {...field}>
        {(control) => (
          <Select
            {...control}
            name="filter.invitationStatus"
            value={value}
            onChange={(event) =>
              onChange(eventEmailCampaignInvitationStatusFilterSchema.parse((event.target as HTMLSelectElement).value))
            }
          >
            {eventEmailCampaignInvitationStatusFilterSchema.options.map((status) => (
              <option key={status} value={status}>
                {INVITATION_STATUS_LABELS[status]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <p class="pk-small">
        Declined, revoked, and opted-out invitations are excluded. Recipients are checked again before delivery.
      </p>
    </div>
  );
}
