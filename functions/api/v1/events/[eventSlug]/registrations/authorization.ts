import type { AdminContext } from "../../../../../_lib/db/context";
import { guardPermissionDatabase } from "../../../../../_lib/auth/permissions";
import { AppError } from "../../../../../_lib/errors";
import { requireEventPermission } from "../authorization";

/**
 * Full registration management exposes attendee identity, form responses,
 * delivery state, and consent data. Keep it behind the event-management
 * capability rather than the broader event read/write permissions.
 *
 * The returned database repeats the permission check inside every D1 batch so
 * a grant revoked after request preflight cannot authorize a later read or
 * mutation commit.
 */
export async function requireEventRegistrationManagement(c: AdminContext, eventSlug: string) {
  const authorization = await requireEventPermission(c, eventSlug, "events:manage");
  const db = guardPermissionDatabase(
    authorization.db,
    authorization.actor,
    [{ permission: "events:manage", context: authorization.context }],
    () =>
      new AppError(
        409,
        "EVENT_REGISTRATION_AUTHORIZATION_CHANGED",
        "Event registration-management permission changed during this request",
      ),
  );
  return { ...authorization, db };
}
