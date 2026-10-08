import { useState } from "preact/hooks";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";

/** A room editor has one dedicated create or existing-room interaction. */
export function useAgendaRoomEditor() {
  const [state, setState] = useState<{ open: boolean; room?: AgendaSnapshot["rooms"][number] }>({ open: false });
  return {
    ...state,
    create: () => setState({ open: true }),
    edit: (room: AgendaSnapshot["rooms"][number]) => setState({ open: true, room }),
    close: () => setState({ open: false }),
  };
}
