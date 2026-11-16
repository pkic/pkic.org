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
  body: Parameters<typeof useContractForm<typeof eventTicketSettingsUpdateSchema>>[1],
  onSaved: () => Promise<void>,
  /** Puts the panel's own fields back to the saved values. */
  resetFields: () => void,
) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const form = useContractForm(eventTicketSettingsUpdateSchema, body);
  function reset() {
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
