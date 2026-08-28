import type { AuthAdmin } from "../types";
import { AppError } from "../errors";
import { requirePermission, type Permission } from "./permissions";

interface RouteDefinition {
  method: string;
  path: string;
}

export type AdminRouteAuthorization =
  { kind: "auth-route" } | { kind: "permission"; permission: Permission } | { kind: "delegated"; boundary: string };

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * These modules resolve a resource before authorizing it, so their router
 * boundary can honor grants scoped to an event, group, or another
 * domain object. Listing and mutation handlers in the remaining delegated
 * modules perform their named permission check directly.
 *
 * Keeping the delegation list here makes that ownership explicit. An unknown
 * top-level admin module is denied without disabling unrelated admin routes.
 */
const DELEGATED_MODULES = new Map<string, string>([
  ["access-grants", "access-grants router"],
  ["applications", "membership application router"],
  ["consortium", "consortium router"],
  ["events", "event router"],
  ["leadership-positions", "leadership router"],
  ["members", "membership router"],
  ["organizations", "organization router"],
  ["proposals", "proposal router"],
  ["roles", "role router"],
  ["sponsorships", "sponsorship router"],
  ["vote-proposals", "vote proposal router"],
  ["votes", "vote router"],
]);

// Retired modules retain only a fail-closed policy tombstone until the admin
// router itself is removed. This lets the absent route return an ordinary 404
// instead of misreporting a server policy-configuration failure.
const RETIRED_MODULES = new Set(["email-templates", "membership-settings"]);

function normalizedPolicyPath(path: string): string {
  const adminPrefix = "/api/v1/admin";
  const relative = path.startsWith(adminPrefix) ? path.slice(adminPrefix.length) : path;
  return relative.startsWith("/") ? relative : `/${relative}`;
}

function moduleName(path: string): string {
  return path.split("/").filter(Boolean)[0] ?? "";
}

function readOrWrite(method: string, read: Permission, write: Permission): Permission {
  return WRITE_METHODS.has(method.toUpperCase()) ? write : read;
}

function isDelegatedUserPath(path: string): boolean {
  return /^\/users\/[^/]+\/(roles|membership)(?:\/|$)/.test(path);
}

/**
 * Resolve the effective authorization boundary for one admin request.
 *
 * Rules describe modules, not a hash of today's route inventory. New routes
 * inherit their module's reviewed policy, while a new module fails closed for
 * that request until a policy is declared. Contextual modules delegate to the
 * nested router that can resolve the resource ID before checking permission.
 */
export function adminAuthorizationForRequest(path: string, method: string): AdminRouteAuthorization {
  const normalizedPath = normalizedPolicyPath(path);
  const normalizedMethod = method.toUpperCase();
  const module = moduleName(normalizedPath);

  if (module === "auth") {
    return { kind: "auth-route" };
  }

  if (module === "audit-log") {
    return { kind: "permission", permission: "audit:read" };
  }
  if (module === "donations") {
    return {
      kind: "permission",
      permission: readOrWrite(normalizedMethod, "donations:read", "donations:sync"),
    };
  }
  if (module === "users" && isDelegatedUserPath(normalizedPath)) {
    return { kind: "delegated", boundary: "user subresource router" };
  }
  if (module === "users") {
    const permission = normalizedPath.endsWith("/anonymize")
      ? "users:anonymize"
      : readOrWrite(normalizedMethod, "users:read", "users:write");
    return { kind: "permission", permission };
  }
  if (module === "email" || module === "forms") {
    return {
      kind: "permission",
      permission: readOrWrite(normalizedMethod, "admin:read", "admin:write"),
    };
  }
  if (
    module === "docs" ||
    module === "redocs" ||
    module.startsWith("openapi.") ||
    module === "due-work" ||
    module === "stats"
  ) {
    return { kind: "permission", permission: "admin:read" };
  }

  const boundary = DELEGATED_MODULES.get(module);
  if (boundary) {
    return { kind: "delegated", boundary };
  }
  if (RETIRED_MODULES.has(module)) {
    return { kind: "delegated", boundary: "retired admin API tombstone" };
  }

  throw new AppError(
    503,
    "ADMIN_ROUTE_POLICY_MISSING",
    `No authorization policy is declared for admin path: ${normalizedPath}`,
  );
}

export function enforceAdminRouteAuthorization(actor: AuthAdmin, path: string, method: string): void {
  const policy = adminAuthorizationForRequest(path, method);
  if (policy.kind === "permission") {
    requirePermission(actor, policy.permission);
  }
}

/** Test/build-time coverage check; unlike the old fingerprint, never runs per request. */
export function requireAdminRoutesHaveAuthorizationPolicy(routes: readonly RouteDefinition[]): void {
  for (const route of routes) {
    if (route.method === "ALL") continue;
    adminAuthorizationForRequest(route.path, route.method);
  }
}
