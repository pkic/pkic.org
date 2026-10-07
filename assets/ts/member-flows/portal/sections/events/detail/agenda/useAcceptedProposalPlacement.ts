import { useEffect, useRef, useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";
import { saveAcceptedProposalAt } from "./accepted-proposal-placement";
export const acceptedProposalDragType = "application/x-pkic-accepted-proposal";
export function useAcceptedProposalPlacement(
  scope: string,
  options: {
    snapshot: AgendaSnapshot | null | undefined;
    onSaved: (snapshot: AgendaSnapshot) => void;
    canEdit: boolean;
  },
) {
  const [selected, setSelected] = useState<{ id: string; title: string; native: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const cancel = () => setSelected(null);
  useEffect(() => {
    cancel();
    setError("");
  }, [scope]);
  useEffect(() => {
    if (!options.canEdit) cancel();
  }, [options.canEdit]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  async function place(startAt: string, roomId: string) {
    const snapshot = options.snapshot;
    const proposal = selected;
    if (!options.canEdit || !snapshot || !proposal || pending.current) return;
    if (!startAt || !roomId) {
      setError("Choose a free calendar slot and location.");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await saveAcceptedProposalAt(snapshot, proposal.id, startAt, roomId);
      options.onSaved(result.agenda);
      setSelected(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not place the accepted proposal.");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return {
    selected,
    busy,
    error,
    cancel,
    select: (proposal: { id: string; title: string }, native = false) => {
      if (!pending.current) {
        setError("");
        setSelected({ ...proposal, native });
      }
    },
    endDrag: () => setSelected((value) => (value?.native && !pending.current ? null : value)),
    place,
  };
}
