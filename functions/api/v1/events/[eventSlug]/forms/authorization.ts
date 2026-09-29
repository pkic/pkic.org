import { guardPermissionMutationDatabase } from "../../../../../_lib/auth/permissions";
import { requestDb } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { requireManagedEventForm } from "../../../../../_lib/services/forms";
import type { UserBackedAuthAdmin } from "../../../../../_lib/types";
export { requireEventPermission as requireEventFormsPermission } from "../authorization";

export function guardedEventFormsDatabase(
  db: ReturnType<typeof requestDb>,
  actor: UserBackedAuthAdmin,
  context: { type: string; id: string },
) {
  return guardPermissionMutationDatabase(
    db,
    actor,
    [{ permission: "events:write", context }],
    () =>
      new AppError(
        409,
        "EVENT_FORM_AUTHORIZATION_CHANGED",
        "Event-management permission changed while the form was being saved",
      ),
  );
}

export async function requireEventForm(
  db: ReturnType<typeof requestDb>,
  eventId: string,
  formKey: string,
  options: { ownedOnly?: boolean } = {},
) {
  return requireManagedEventForm(db, eventId, formKey, options);
}
