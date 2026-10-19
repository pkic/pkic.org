import { scannerPermission, type ScannerCapability } from "../../../../../assets/shared/event-scanner-permissions";
import type { Permission } from "../../../../../assets/shared/schemas/permissions";
import { requireUserBackedAdminFromRequest } from "../../../../_lib/auth/admin";
import { hasPermission, requireAnyPermission, requirePermission } from "../../../../_lib/auth/permissions";
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

/**
 * Event-scoped authorization for a resource several capacities may read: the
 * first permission the actor holds is the one checked, and returned so the
 * route can guard its reads with it.
 */
export async function requireAnyEventPermission(
  c: AdminContext,
  eventSlug: string,
  permissions: readonly [Permission, ...Permission[]],
) {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, eventSlug);
  const context = { type: "event", id: event.id };
  requireAnyPermission(actor, permissions, context);
  const permission = permissions.find((candidate) => hasPermission(actor, candidate, context)) ?? permissions[0];
  return { actor, context, db, event, permission };
}

export function eventManagementCapabilities(
  actor: Awaited<ReturnType<typeof requireUserBackedAdminFromRequest>>,
  context: { type: string; id: string },
): Array<"read" | "write" | "manage"> {
  return [
    ...(hasPermission(actor, "events:read", context) ? (["read"] as const) : []),
    ...(hasPermission(actor, "events:write", context) ? (["write"] as const) : []),
    ...(hasPermission(actor, "events:manage", context) ? (["manage"] as const) : []),
  ];
}

/** Anonymous access is valid; a supplied but invalid credential is not silently downgraded. */
export async function resolveOptionalEventUserSession(c: AdminContext): Promise<UserSessionResult | null> {
  if (!getUserSessionToken(c.req.raw)) return null;
  return resolveUserSessionFromRequest(requestDb(c), c.req.raw, {
    INTERNAL_SIGNING_SECRET: c.env.INTERNAL_SIGNING_SECRET,
  });
}

export async function requireEventScannerPermission(
  c: AdminContext,
  eventSlug: string,
  capability: ScannerCapability | readonly ScannerCapability[],
) {
  const db = requestDb(c);
  const actor = await requireUserBackedAdminFromRequest(db, c.req.raw, c.env);
  const event = await getEventBySlug(db, eventSlug);
  const context = { type: "event", id: event.id };
  const capabilities = typeof capability === "string" ? [capability] : capability;
  const permission = capabilities
    .map((value) => scannerPermission((candidate) => hasPermission(actor, candidate, context), value))
    .find(Boolean);
  if (!permission) requirePermission(actor, capabilities[0]!, context);
  return { actor, context, db, event, permission: permission ?? capabilities[0]! };
}
