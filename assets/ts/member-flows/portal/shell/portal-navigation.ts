/**
 * Single source of truth for portal navigation: every top-level section the
 * portal owns is declared once here with its access rule. Sidebar items, the
 * active-section highlight, capacity fallbacks, and the shell's route guards
 * all derive from this manifest so they cannot drift apart.
 */
import type { PortalSession } from "../types";

export interface PortalNavItem {
  path: string;
  section: string;
  label: string;
}

interface SystemNavItem extends PortalNavItem {
  permission?: string;
  permissions?: readonly string[];
}

const SYSTEM_NAV_ITEMS: readonly SystemNavItem[] = [
  {
    path: "/system/analytics",
    section: "system",
    label: "Analytics",
    permission: "analytics:read",
  },
  {
    path: "/system/donations",
    section: "system",
    label: "Donations",
    permissions: ["donations:read", "donations:sync"],
  },
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
  {
    path: "/system/organizations",
    section: "system",
    label: "Organizations",
    permissions: ["organizations:read", "membership:write"],
  },
  {
    path: "/system/users",
    section: "system",
    label: "Users",
    permission: "users:read",
  },
  { path: "/system/audit-log", section: "system", label: "Audit Log", permission: "audit:read" },
  {
    path: "/system/email-templates",
    section: "system",
    label: "Email Templates",
    permissions: ["email-templates:read", "email-templates:write"],
  },
  {
    path: "/system/operations",
    section: "system",
    label: "Operations",
    permissions: ["email:read", "retention:read", "scheduler:read"],
  },
  {
    path: "/system/access-control",
    section: "system",
    label: "Access Control",
    permissions: ["access:grant", "access:revoke"],
  },
  {
    path: "/system/leadership",
    section: "system",
    label: "Leadership",
    permissions: ["access:grant", "access:revoke"],
  },
] as const;

/** Mirrors the backend's global-permission semantics for navigation only. */
export function portalHasGlobalPermission(session: PortalSession | null, permission: string): boolean {
  const staff = session?.staff;
  if (!staff) return false;
  if (staff.role === "admin") return true;
  return staff.grants.some(
    (grant) => grant.permission === permission && grant.contextType === null && grant.contextId === null,
  );
}

export function portalHasAnyGlobalPermission(session: PortalSession | null, permissions: readonly string[]): boolean {
  return permissions.some((permission) => portalHasGlobalPermission(session, permission));
}

/**
 * Contextual event roles must make their own event workspace discoverable.
 * The API remains authoritative for the rows and fields the identity may see.
 */
export function portalHasPermissionAtAnyScope(session: PortalSession | null, permission: string): boolean {
  const staff = session?.staff;
  if (!staff) return false;
  if (staff.role === "admin") return true;
  return staff.grants.some((grant) => grant.permission === permission);
}

export function portalSystemNavigationItems(session: PortalSession | null): PortalNavItem[] {
  return SYSTEM_NAV_ITEMS.filter((item) =>
    item.permissions
      ? portalHasAnyGlobalPermission(session, item.permissions)
      : item.permission
        ? portalHasGlobalPermission(session, item.permission)
        : false,
  ).map(({ path, section, label }) => ({ path, section, label }));
}

export function portalHasSystemManagement(session: PortalSession | null): boolean {
  return portalSystemNavigationItems(session).length > 0;
}

export function portalHasSponsorWorkspace(session: PortalSession | null): boolean {
  return Boolean(
    session?.sponsors.length ||
    portalHasGlobalPermission(session, "sponsorships:read") ||
    portalHasGlobalPermission(session, "sponsorships:write"),
  );
}

export type PortalSectionKey =
  "groups" | "events" | "sponsors" | "forms" | "profile" | "organization" | "application" | "system" | "account";

interface PortalSectionDef {
  /** Stable key; equal to the first URL segment the section owns. */
  section: PortalSectionKey;
  /** Sidebar destination. The system section resolves dynamically to the first permitted view. */
  path: string;
  label: string;
  sidebar: boolean;
  access: (session: PortalSession | null) => boolean;
}

const PORTAL_SECTIONS: readonly PortalSectionDef[] = [
  {
    section: "groups",
    path: "/groups",
    label: "Groups",
    sidebar: true,
    access: (session) => Boolean(session?.member || session?.staff),
  },
  {
    section: "events",
    path: "/events",
    label: "Events",
    sidebar: true,
    access: (session) => portalHasPermissionAtAnyScope(session, "events:read"),
  },
  {
    section: "sponsors",
    path: "/sponsors",
    label: "Sponsors",
    sidebar: true,
    access: portalHasSponsorWorkspace,
  },
  {
    section: "forms",
    path: "/forms",
    label: "Forms",
    sidebar: true,
    access: (session) => portalHasGlobalPermission(session, "forms:read"),
  },
  {
    section: "profile",
    path: "/profile",
    label: "My Profile",
    sidebar: true,
    access: (session) => Boolean(session?.member),
  },
  {
    section: "organization",
    path: "/organization",
    label: "My Organization",
    sidebar: true,
    access: (session) => Boolean(session?.member),
  },
  {
    section: "application",
    path: "/application",
    label: "My Application",
    sidebar: true,
    access: (session) => Boolean(session?.member),
  },
  {
    section: "system",
    path: "/system",
    label: "Administration",
    sidebar: true,
    access: portalHasSystemManagement,
  },
  {
    section: "account",
    path: "/account",
    label: "Account Settings",
    sidebar: false,
    access: (session) => Boolean(session?.member || session?.staff),
  },
];

export const PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS = {
  "/working-groups": "/groups",
  "/calendar": "/groups",
} as const;

/** Superseded route prefixes that the groups section now owns and redirects. */
const LEGACY_GROUPS_PREFIXES = ["/management", ...Object.keys(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS)];

function ownsLocation(prefix: string, location: string): boolean {
  return location === prefix || location.startsWith(`${prefix}/`);
}

function portalSectionForLocation(location: string): PortalSectionDef | null {
  if (LEGACY_GROUPS_PREFIXES.some((prefix) => ownsLocation(prefix, location))) {
    return PORTAL_SECTIONS.find((def) => def.section === "groups") ?? null;
  }
  return PORTAL_SECTIONS.find((def) => ownsLocation(def.path, location)) ?? null;
}

export function portalSectionEnabled(session: PortalSession | null, section: PortalSectionKey): boolean {
  const def = PORTAL_SECTIONS.find((candidate) => candidate.section === section);
  return def ? def.access(session) : false;
}

export function portalNavigationItems(session: PortalSession | null): PortalNavItem[] {
  return PORTAL_SECTIONS.filter((def) => def.sidebar && def.access(session)).map((def) => {
    if (def.section === "system") {
      const home = portalSystemNavigationItems(session)[0];
      return { path: home?.path ?? def.path, section: def.section, label: def.label };
    }
    return { path: def.path, section: def.section, label: def.label };
  });
}

export function portalDefaultPath(session: PortalSession | null): string {
  if (session?.member || session?.staff) return "/groups";
  if (session?.sponsors.length) return "/sponsors";
  return "/";
}

/**
 * Reconciles a previously valid capacity route after live authorization
 * changes. Unknown URLs remain a real not-found state; only a route owned by
 * a capacity the identity just lost moves to the remaining valid home.
 */
export function portalCapacityFallbackPath(session: PortalSession | null, location: string): string | null {
  const owner = portalSectionForLocation(location);
  if (!owner) return null;
  if (owner.access(session)) return null;
  return portalDefaultPath(session);
}

export function portalActiveSection(location: string): string {
  const owner = portalSectionForLocation(location);
  if (owner) return owner.section;
  return location.replace(/^\//, "").split("/")[0] || "groups";
}
