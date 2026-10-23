/** Stable registration lookup used before a create-or-restore decision resolves its ID. */
export type RegistrationReadSelection = { registrationId: string } | { eventId: string; userId: string };

export function registrationReadIdSql(selection: RegistrationReadSelection) {
  return "registrationId" in selection
    ? { sql: "?", bindings: [selection.registrationId] }
    : {
        sql: "(SELECT id FROM registrations WHERE event_id=? AND user_id=?)",
        bindings: [selection.eventId, selection.userId],
      };
}
