import { useRef, useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { formatNumber } from "../../../../../../../shared/format-number";
import { acceptedProposalIds, placeAcceptedProposals } from "./accepted-proposal-batches";

/** Place accepted sources on the viewed day through the ordinary guarded importer. */
export function useAcceptedProposalImport(
  snapshot: AgendaSnapshot,
  onSaved: (agenda: AgendaSnapshot) => void,
  canEdit: boolean,
  viewedDay: string | undefined,
  timeStep: number,
) {
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  async function add(selectedIds?: string[]) {
    if (!canEdit || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setProgress("Adding accepted proposals…");
    let committed: AgendaSnapshot | undefined;
    try {
      if (!viewedDay) throw new Error("Choose an agenda day before adding proposals.");
      const ids = selectedIds ?? (await acceptedProposalIds(snapshot.eventSlug));
      const result = await placeAcceptedProposals(snapshot, ids, viewedDay, timeStep, (agenda, placed) => {
        committed = agenda;
        setProgress(`${formatNumber(placed)} scheduled on ${viewedDay}.`);
      });
      committed = result.agenda;
      setProgress(`${formatNumber(result.placed)} scheduled on ${viewedDay}.`);
      if (result.noFit.length) setError(result.noFit.join(" "));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not add accepted proposals.");
      if (!committed) setProgress("");
    } finally {
      // Earlier batches remain real even if a later batch refuses; refresh the canonical revision for retry.
      if (committed) onSaved(committed);
      pending.current = false;
      setBusy(false);
    }
  }
  return { add, busy, error, progress };
}
