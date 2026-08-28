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
  { path: "/votes", section: "votes", label: "Votes" },
  { path: "/application", section: "application", label: "My Application" },
];

const MANAGEMENT_NAV_ITEM: PortalNavItem = {
  path: "/management",
  section: "management",
  label: "Management",
};

const SYSTEM_NAV_ITEMS = [
  {
    path: "/system/membership-applications",
    section: "system",
    label: "Membership Applications",
    permission: "membership:read",
  },
  {
    path: "/system/membership-settings",
    section: "system",
    label: "Membership Settings",
    permission: "membership:read",
  },
  {
    path: "/system/organization-content-reviews",
    section: "system",
    label: "Content Reviews",
    permission: "organizations:content-review",
  },
  { path: "/system/audit-log", section: "system", label: "Audit Log", permission: "audit:read" },
  {
    path: "/system/email-templates",
    section: "system",
    label: "Email Templates",
    permission: "email-templates:read",
  },
] as const;

const ACCOUNT_NAV_ITEM: PortalNavItem = { path: "/account", section: "account", label: "Account Settings" };

export const PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS = {
  "/working-groups": "/groups",
  "/calendar": "/groups",
} as const;
const CAPACITY_ROUTE_PATHS = new Set([
  ...MEMBER_NAV_ITEMS.map((item) => item.path),
  ...Object.keys(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS),
  MANAGEMENT_NAV_ITEM.path,
  ...SYSTEM_NAV_ITEMS.map((item) => item.path),
  ACCOUNT_NAV_ITEM.path,
]);

/** Mirrors the backend's global-permission semantics for navigation only. */
export function portalHasGlobalPermission(session: PortalSession | null, permission: string): boolean {
  const staff = session?.admin;
  if (!staff) return false;
  if (staff.role === "admin") return true;
  return staff.grants.some(
    (grant) => grant.permission === permission && grant.contextType === null && grant.contextId === null,
  );
}

export function portalSystemNavigationItems(session: PortalSession | null): PortalNavItem[] {
  return SYSTEM_NAV_ITEMS.filter((item) => portalHasGlobalPermission(session, item.permission)).map(
    ({ path, section, label }) => ({ path, section, label }),
  );
}

export function portalHasSystemManagement(session: PortalSession | null): boolean {
  return portalSystemNavigationItems(session).length > 0;
}

export function portalNavigationItems(session: PortalSession | null): PortalNavItem[] {
  const systemHome = portalSystemNavigationItems(session)[0];
  return [
    ...(session?.member ? MEMBER_NAV_ITEMS : []),
    ...(session?.admin ? [MANAGEMENT_NAV_ITEM] : []),
    ...(systemHome ? [{ ...systemHome, label: "System" }] : []),
    ...(session?.member || session?.admin ? [ACCOUNT_NAV_ITEM] : []),
  ];
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
  const isSystemRoute = location === "/system" || location.startsWith("/system/");
  const isSelectedGroupRoute = location.startsWith("/groups/");
  if (!CAPACITY_ROUTE_PATHS.has(location) && !isManagementRoute && !isSystemRoute && !isSelectedGroupRoute) return null;
  if (portalNavigationItems(session).some((item) => item.path === location)) return null;
  if (isManagementRoute && session?.admin) return null;
  if (isSystemRoute && portalHasSystemManagement(session)) return null;
  if (isSelectedGroupRoute && (session?.member || session?.admin)) return null;
  return portalDefaultPath(session);
}

export function portalActiveSection(location: string, session?: PortalSession | null): string {
  if (location.startsWith("/groups/") && !session?.member && session?.admin) return "management";
  const top = location.replace(/^\//, "").split("/")[0];
  return top || "profile";
}
