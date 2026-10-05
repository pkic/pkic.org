import { useEffect, useState } from "preact/hooks";
export const acceptedProposalDragType = "application/x-pkic-accepted-proposal";
export function useAcceptedProposalPlacement(scope: string) {
  const [selected, setSelected] = useState<{ id: string; title: string; native: boolean } | null>(null);
  const [candidate, setCandidate] = useState<{ id: string; title: string; startAt: string; roomId: string } | null>(
    null,
  );
  const cancel = () => {
    setSelected(null);
    setCandidate(null);
  };
  useEffect(cancel, [scope]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel();
    };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, []);
  return {
    selected,
    candidate,
    cancel,
    select: (proposal: { id: string; title: string }, native = false) => setSelected({ ...proposal, native }),
    endDrag: () => setSelected((value) => (value?.native ? null : value)),
    place: (startAt: string, roomId: string) => {
      if (selected) {
        setCandidate({ id: selected.id, title: selected.title, startAt, roomId });
        setSelected(null);
      }
    },
  };
}
