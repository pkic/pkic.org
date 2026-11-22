import { personalAgendaProgramResponseSchema } from "../../../../../../../shared/schemas/event-personal-agenda";
import { useData } from "../../../../../../hooks/useData";
import { getJson } from "../../../../../../shared/api-client";

/**
 * The event's published program with the reader's marks. One page reads it once: the virtual room hands
 * what it read to the agenda it shows, so the agenda asks the server for nothing more.
 */
export function useAgendaProgram(slug: string) {
  return useData(
    () =>
      getJson(
        `/api/v1/events/${encodeURIComponent(slug)}/agenda/participation/program`,
        personalAgendaProgramResponseSchema,
      ),
    [slug],
  );
}

export type AgendaProgram = ReturnType<typeof useAgendaProgram>;
