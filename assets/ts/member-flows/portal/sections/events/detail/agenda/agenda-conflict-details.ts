import { agendaScheduleConflictDetailsSchema } from "../../../../../../../shared/schemas/event-agenda-schedule";
import { ApiClientError } from "../../../../../../shared/api-client";

export function agendaConflictDetails(error: unknown) {
  if (!(error instanceof ApiClientError) || error.code !== "AGENDA_SCHEDULE_CONFLICT" || error.status !== 409)
    return null;
  const parsed = agendaScheduleConflictDetailsSchema.safeParse(error.details);
  return parsed.success ? parsed.data : null;
}
