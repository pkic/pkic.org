/** One settings form for the event's tickets: the contract, the edit state, and the save every panel shares. */
import { useState } from "preact/hooks";
import { putJson } from "../../../../../../../shared/api-client";
import {
  eventTicketGuidanceUpdateSchema,
  eventTicketSettingsUpdateSchema,
  eventTicketsChangeResponseSchema,
} from "../../../../../../../../shared/schemas/event-tickets";
import { useContractForm } from "../../../../../../../hooks/useContractForm";
import { ticketsEndpoint } from "./tickets-endpoint";

/** The settings a panel saves: payment settings, or what registrants read. */
const TICKET_SETTINGS_CONTRACTS = {
  settings: eventTicketSettingsUpdateSchema,
  guidance: eventTicketGuidanceUpdateSchema,
} as const;
type TicketSettingsContract = keyof typeof TICKET_SETTINGS_CONTRACTS;

export function useTicketSettingsForm<Contract extends TicketSettingsContract>(
  slug: string,
  /** Which settings the panel saves, and where. */
  contract: Contract,
  /** The revision of the saved settings; the draft keeps the one it was copied from. */
  revision: number,
  fields: Omit<Parameters<typeof useContractForm<(typeof TICKET_SETTINGS_CONTRACTS)[Contract]>>[1], "expectedRevision">,
  onSaved: () => Promise<void>,
  /** Puts the panel's own fields back to the saved values. */
  resetFields: () => void,
) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // A save of a draft copied before someone else's change is refused instead of overwriting that change.
  const [draftRevision, setDraftRevision] = useState(revision);
  const form = useContractForm(TICKET_SETTINGS_CONTRACTS[contract], { ...fields, expectedRevision: draftRevision });
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
      await putJson(`${ticketsEndpoint(slug)}/${contract}`, checked.data, eventTicketsChangeResponseSchema);
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
