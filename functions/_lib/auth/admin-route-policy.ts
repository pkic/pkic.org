import { AppError } from "../errors";

interface RouteDefinition {
  method: string;
  path: string;
}

interface AdminRouteInventory {
  routeCount: number;
  fingerprint: string;
}

// This fingerprint is intentionally reviewed and updated separately from route
// registration. A new non-auth admin route remains unavailable until its
// authorization policy has been reviewed and the inventory is updated.
const REVIEWED_ADMIN_ROUTE_INVENTORY: AdminRouteInventory = {
  routeCount: 189,
  fingerprint: "d38f5d14c74964bb",
};

function isAuthRoute(path: string): boolean {
  return path === "/auth" || path.startsWith("/auth/");
}

export function adminRouteInventoryFingerprint(routes: readonly RouteDefinition[]): AdminRouteInventory {
  const entries = routes
    .filter((route) => route.method !== "ALL" && !isAuthRoute(route.path))
    .map((route) => `${route.method.toUpperCase()} ${route.path}`)
    .sort();

  // FNV-1a 64-bit gives us a compact, deterministic snapshot that changes
  // when a method, path, or route count changes.
  let hash = 0xcbf29ce484222325n;
  for (const codePoint of entries.join("\n")) {
    hash ^= BigInt(codePoint.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return {
    routeCount: entries.length,
    fingerprint: hash.toString(16).padStart(16, "0"),
  };
}

export function requireReviewedAdminRouteInventory(routes: readonly RouteDefinition[]): void {
  const actual = adminRouteInventoryFingerprint(routes);
  if (
    actual.routeCount !== REVIEWED_ADMIN_ROUTE_INVENTORY.routeCount ||
    actual.fingerprint !== REVIEWED_ADMIN_ROUTE_INVENTORY.fingerprint
  ) {
    throw new AppError(
      503,
      "ADMIN_ROUTE_POLICY_OUT_OF_DATE",
      "The admin route inventory changed without an authorization-policy review.",
    );
  }
}
