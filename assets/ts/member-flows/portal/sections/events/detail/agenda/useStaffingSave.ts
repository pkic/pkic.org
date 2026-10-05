import { useState } from "preact/hooks";
import type { z } from "zod";
import {
  agendaSnapshotSchema,
  type agendaStaffingSchema,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import type { ContractForm } from "../../../../../../hooks/useContractForm";
import { postJson } from "../../../../../../shared/api-client";

/** Catalog and block requirements share one validated staffing save lifecycle. */
export function useStaffingSave(
  eventSlug: string,
  form: ContractForm<z.output<typeof agendaStaffingSchema>>,
  onSaved: (next: AgendaSnapshot) => void,
  onClose: () => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: Event): Promise<void> {
    event.preventDefault();
    const checked = form.submit();
    if (!checked.data) {
      setError(checked.message);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await postJson(
        `/api/v1/events/${encodeURIComponent(eventSlug)}/agenda/staffing`,
        checked.data,
        agendaSnapshotSchema,
      );
      onSaved(saved);
      onClose();
    } catch (failure) {
      setError(form.refuse(failure));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, save };
}
