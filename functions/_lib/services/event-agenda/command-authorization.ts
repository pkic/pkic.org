import { guardPermissionDatabase } from "../../auth/permissions";
import { AppError } from "../../errors";
import type { DatabaseLike, UserBackedAuthAdmin } from "../../types";

/** Agenda writes recheck their live event permission inside the atomic revision command. */
export function agendaWriteDatabase(db: DatabaseLike, actor: UserBackedAuthAdmin, eventId: string) {
  return guardPermissionDatabase(
    db,
    actor,
    [{ permission: "agenda:write", context: { type: "event", id: eventId } }],
    () => new AppError(409, "AGENDA_AUTHORIZATION_CHANGED", "Agenda permission changed"),
  );
}
