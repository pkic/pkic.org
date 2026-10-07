import type { ComponentChildren } from "preact";
import { ApiDataTable } from "../../../../../../components/ApiDataTable";
import type { DataTableSelection } from "../../../../../../ui/DataTable";
import type { z } from "zod";
import { useColumnFilterOptions } from "../../../../../../hooks/useColumnFilterOptions";
import type { RowActionsProps } from "../../../../../../ui/RowActions";
import {
  agendaOccurrenceListSchema,
  type AgendaOccurrence,
  type AgendaSnapshot,
} from "../../../../../../../shared/schemas/event-agenda";
import { agendaSessionColumns } from "./session-table-columns";
/** Session rows and speaker choices have independent server pagination. */
export function AgendaSessionTable({
  data,
  days,
  canAct,
  actions,
  onEdit,
  selection,
  onData,
  toolbar,
  onNewSession,
  retainUrlStateOnUnmount,
}: {
  retainUrlStateOnUnmount?: boolean;
  toolbar?: ComponentChildren;
  onNewSession?: () => void;
  data: AgendaSnapshot;
  days: Array<{ date: string }>;
  canAct: boolean;
  actions: (row: AgendaOccurrence) => RowActionsProps["actions"];
  onEdit?: (row: AgendaOccurrence) => void;
  selection?: DataTableSelection;
  onData?: (response: z.infer<typeof agendaOccurrenceListSchema>) => void;
}) {
  const base = `/api/v1/events/${encodeURIComponent(data.eventSlug)}/agenda/occurrences`;
  const speakers = useColumnFilterOptions(`${base}/filters`, "speakerUserId", "All speakers");
  return (
    <ApiDataTable
      toolbar={() => toolbar}
      createAction={onNewSession ? { label: "New session", onSelect: onNewSession } : undefined}
      endpoint={base}
      responseSchema={agendaOccurrenceListSchema}
      resolve={(response) => response.occurrences}
      resolvePage={(response) => response.page}
      paginate
      urlState="agenda"
      retainUrlStateOnUnmount={retainUrlStateOnUnmount}
      caption="Event sessions"
      empty="No event sessions match this search. Add a session here, or reuse content from the session library."
      rowKey={(row) => row.id}
      selection={selection}
      onData={onData}
      rowAction={onEdit ? (row) => ({ label: `Edit ${row.title}`, onSelect: () => onEdit(row) }) : undefined}
      searchPlaceholder="Search sessions…"
      initialSort="startAt"
      columns={agendaSessionColumns(data, days, canAct, actions, speakers)}
    />
  );
}
