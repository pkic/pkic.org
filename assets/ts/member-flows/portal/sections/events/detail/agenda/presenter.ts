import { agendaContent } from "../../../../../../../shared/public-agenda-content";
import type { AgendaSnapshot } from "../../../../../../../shared/schemas/event-agenda";

/** Organizer mode preserves private planned content and editor session identity. */
export function agendaPresenter(snapshot: AgendaSnapshot) {
  return agendaContent(snapshot, true).days;
}
