import type { Permission } from "../../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { hasPermission, requirePermission } from "../../../../_lib/auth/permissions";
import { requestDb, type AdminContext } from "../../../../_lib/db/context";
import { getEventBySlug } from "../../../../_lib/services/events";
import { getUserSessionToken, resolveUserSessionFromRequest } from "../../../../_lib/auth/user-session";
import type { UserSessionResult } from "../../../../_lib/auth/user-session";

/** Shared user-backed, event-scoped authorization for canonical event resources. */
export async function requireEventPermission(c: AdminContext, eventSlug: string, permission: Permission) {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, eventSlug);
  const context = { type: "event", id: event.id };
  requirePermission(actor, permission, context);
  return { actor, context, db, event };
}

export function eventManagementCapabilities(
  actor: Awaited<ReturnType<typeof requireUserBackedAdminFromRequest>>,
  context: { type: string; id: string },
): Array<"read" | "write"> {
  return [
    ...(hasPermission(actor, "events:read", context) ? (["read"] as const) : []),
    ...(hasPermission(actor, "events:write", context) ? (["write"] as const) : []),
  ];
}

/** Anonymous access is valid; a supplied but invalid credential is not silently downgraded. */
export async function resolveOptionalEventUserSession(c: AdminContext): Promise<UserSessionResult | null> {
  if (!getUserSessionToken(c.req.raw)) return null;
  return resolveUserSessionFromRequest(requestDb(c), c.req.raw, {
    INTERNAL_SIGNING_SECRET: c.env.INTERNAL_SIGNING_SECRET,
  });
}
