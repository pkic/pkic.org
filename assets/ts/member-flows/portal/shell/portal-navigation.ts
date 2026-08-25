import type { PortalSession } from "../types";

export interface PortalNavItem {
  path: string;
  section: string;
  label: string;
}

const MEMBER_NAV_ITEMS: PortalNavItem[] = [
  { path: "/profile", section: "profile", label: "My Profile" },
  { path: "/organization", section: "organization", label: "My Organization" },
  { path: "/groups", section: "groups", label: "Groups" },
  { path: "/calendar", section: "calendar", label: "Calendar" },
  { path: "/votes", section: "votes", label: "Votes" },
  { path: "/application", section: "application", label: "My Application" },
  { path: "/account", section: "account", label: "Account Settings" },
];

const MANAGEMENT_NAV_ITEM: PortalNavItem = {
  path: "/management",
  section: "management",
  label: "Management",
};

export const PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS = { "/working-groups": "/groups" } as const;
const CAPACITY_ROUTE_PATHS = new Set([
  ...MEMBER_NAV_ITEMS.map((item) => item.path),
  ...Object.keys(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS),
  MANAGEMENT_NAV_ITEM.path,
]);

export function portalNavigationItems(session: PortalSession | null): PortalNavItem[] {
  return [...(session?.member ? MEMBER_NAV_ITEMS : []), ...(session?.admin ? [MANAGEMENT_NAV_ITEM] : [])];
}

export function portalDefaultPath(session: PortalSession | null): string {
  return session?.member ? "/profile" : "/management";
}

/**
 * Reconciles a previously valid capacity route after live authorization
 * changes. Unknown URLs remain a real not-found state; only a route owned by
 * a capacity the identity just lost moves to the remaining valid home.
 */
export function portalCapacityFallbackPath(session: PortalSession | null, location: string): string | null {
  const isManagementRoute =
    location === MANAGEMENT_NAV_ITEM.path || location.startsWith(`${MANAGEMENT_NAV_ITEM.path}/`);
  if (!CAPACITY_ROUTE_PATHS.has(location) && !isManagementRoute) return null;
  if (portalNavigationItems(session).some((item) => item.path === location)) return null;
  if (isManagementRoute && session?.admin) return null;
  return portalDefaultPath(session);
}

export function portalActiveSection(location: string): string {
  const top = location.replace(/^\//, "").split("/")[0];
  return top || "profile";
}
