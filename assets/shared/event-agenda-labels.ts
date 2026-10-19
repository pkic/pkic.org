/**
 * The words organizers read for the agenda's stored vocabularies. A list
 * column, its filter menu and an editor's options name a value the same way,
 * and none of them shows the stored key ("optional_reservation").
 */
import type { z } from "zod";
import type {
  agendaAccessPolicySchema,
  agendaAdmissionPolicySchema,
  agendaSessionKindSchema,
  agendaVisibilitySchema,
} from "./schemas/event-agenda";

export const AGENDA_SESSION_KIND_LABELS: Record<z.infer<typeof agendaSessionKindSchema>, string> = {
  session: "Session",
  break: "Break",
  plenary: "Plenary",
};

export const AGENDA_ADMISSION_POLICY_LABELS: Record<z.infer<typeof agendaAdmissionPolicySchema>, string> = {
  preference: "Open seating (first come, first served)",
  optional_reservation: "Optional reservation",
  reservation: "Reservation required",
  approval: "Approval required",
};

export const AGENDA_ACCESS_POLICY_LABELS: Record<z.infer<typeof agendaAccessPolicySchema>, string> = {
  open: "Open",
  invitation: "Invitation only",
};

export const AGENDA_VISIBILITY_LABELS: Record<z.infer<typeof agendaVisibilitySchema>, string> = {
  public: "Public",
  private: "Private",
};

/**
 * A move in the running order of one location: the session trades places with its neighbor, or takes the
 * free time before or after it. Distinct from nudging the start time by the planner's time step.
 */
export function agendaOrderMoveLabel(direction: -1 | 1, subject?: string): string {
  const session = subject ? ` ${subject}` : "";
  return direction === -1 ? `Move${session} before the previous session` : `Move${session} after the next session`;
}
