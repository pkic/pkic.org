import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  eventManagementDetailResponseSchema,
  type eventSettingsUpdateSchema,
  type EventDetail,
} from "../../../../../../../shared/schemas/event-management";
import type { ContractForm } from "../../../../../../hooks/useContractForm";
import { patchJson } from "../../../../../../shared/api-client";
import { groupEventDetailResponseSchema } from "../../../../../../../shared/schemas/group-events";

export interface EventSettingsGroupTarget {
  groupId: string;
  eventId: string;
  canEdit: boolean;
  onSaved: () => void | Promise<void>;
}

/**
 * One event settings section's edit and save: whether it is being edited,
 * whether a save is under way, the section's message, and the save that
 * sends the section's contract to the event's settings endpoint.
 */
export function useEventSettingsSave(
  slug: string,
  form: ContractForm<z.output<typeof eventSettingsUpdateSchema>>,
  onUpdated: (event: EventDetail) => void,
  groupTarget?: EventSettingsGroupTarget,
) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function save(submitEvent: Event) {
    submitEvent.preventDefault();
    if (!editing || saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      if (groupTarget) {
        await patchJson(
          `/api/v1/groups/${encodeURIComponent(groupTarget.groupId)}/events/${encodeURIComponent(groupTarget.eventId)}/settings`,
          checked.data,
          groupEventDetailResponseSchema,
        );
        await groupTarget.onSaved();
      } else {
        const response = await patchJson(
          `/api/v1/events/${encodeURIComponent(slug)}/settings`,
          checked.data,
          eventManagementDetailResponseSchema,
        );
        onUpdated(response.event);
      }
      setEditing(false);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  return { editing, setEditing, saving, error, setError, save };
}
