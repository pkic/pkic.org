/** One settings form for the event's tickets: the contract, the edit state, and the save every panel shares. */
import { useState } from "preact/hooks";
import { putJson } from "../../../../../../../shared/api-client";
import {
  eventTicketSettingsUpdateSchema,
  eventTicketsChangeResponseSchema,
  type EventTicketSettingsUpdate,
} from "../../../../../../../../shared/schemas/event-tickets";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { ticketsEndpoint } from "./tickets-endpoint";

export function useTicketSettingsForm(
  slug: string,
  /** The revision of the saved settings; the draft keeps the one it was copied from. */
  revision: number,
  fields: Omit<Parameters<typeof useContractForm<typeof eventTicketSettingsUpdateSchema>>[1], "expectedRevision">,
  onSaved: () => Promise<void>,
  /** Puts the panel's own fields back to the saved values. */
  resetFields: () => void,
) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A save of a draft copied before someone else's change is refused instead of overwriting that change.
  const [draftRevision, setDraftRevision] = useState(revision);
  const form = useContractForm(eventTicketSettingsUpdateSchema, { ...fields, expectedRevision: draftRevision });
  function reset() {
    setDraftRevision(revision);
    resetFields();
    form.reset();
    setError("");
  }
  async function save(submitEvent: Event) {
    submitEvent.preventDefault();
    if (!editing || saving) return;
    const checked = form.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      const data: EventTicketSettingsUpdate = checked.data;
      await putJson(`${ticketsEndpoint(slug)}/settings`, data, eventTicketsChangeResponseSchema);
      await onSaved();
      setEditing(false);
    } catch (cause) {
      setError(form.refuse(cause));
    } finally {
      setSaving(false);
    }
  }
  return {
    form,
    editing,
    saving,
    error,
    save,
    edit: () => {
      reset();
      setEditing(true);
    },
    cancel: () => {
      reset();
      setEditing(false);
    },
  };
}
