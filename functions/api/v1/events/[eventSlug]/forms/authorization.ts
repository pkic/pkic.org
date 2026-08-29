import type { Permission } from "../../../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../../../_lib/auth/admin";
import { guardPermissionMutationDatabase, requirePermission } from "../../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../../_lib/db/context";
import { AppError } from "../../../../../_lib/errors";
import { requireManagedEventForm } from "../../../../../_lib/services/forms";
import { getEventBySlug } from "../../../../../_lib/services/events";

export async function requireEventFormsPermission(c: AdminContext, eventSlug: string, permission: Permission) {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, eventSlug);
  const context = { type: "event", id: event.id };
  requirePermission(actor, permission, context);
  return { actor, context, db, event };
}

export function guardedEventFormsDatabase(
  db: ReturnType<typeof requestDb>,
  actor: Awaited<ReturnType<typeof requireUserBackedAdminFromRequest>>,
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
