/**
 * Single source of truth for portal navigation: every top-level section the
 * portal owns is declared once here with its access rule. Sidebar items, the
 * active-section highlight, capacity fallbacks, and the shell's route guards
 * all derive from this manifest so they cannot drift apart.
 */
import type { PortalSession } from "../types";

export interface PortalNavItem {
  group?: string;
  path: string;
  section: string;
  label: string;
  /** One sentence saying what the page is, for a section index that lists it. */
  description?: string;
}

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

/**
 * The settings pages this session may open.
 *
 * Settings has no surface of its own beyond the index that lists these: every
 * one of them is a page, declared as a child of the section, so the sidebar,
 * the index and the router all read the same list.
 */
export function portalSettingsPages(session: PortalSession | null): PortalNavItem[] {
  return portalSectionChildren("settings", session);
}

export function portalHasSettingsAccess(session: PortalSession | null): boolean {
  return portalSettingsPages(session).length > 0;
}

export function portalHasSponsorWorkspace(session: PortalSession | null): boolean {
  return Boolean(
    session?.sponsors.length ||
    portalHasGlobalPermission(session, "sponsorships:read") ||
    portalHasGlobalPermission(session, "sponsorships:write"),
  );
}

export type PortalSectionKey =
  | "home"
  | "participation"
  | "groups"
  | "events"
  | "organizations"
  | "members"
  | "membership"
  | "users"
  | "donations"
  | "sponsors"
  | "forms"
  | "organization"
  | "application"
  | "settings"
  | "account";

interface PortalSectionDef {
  /** Stable key; equal to the first URL segment the section owns. */
  section: PortalSectionKey;
  /** Sidebar destination, and the section's own root page. */
  path: string;
  label: string;
  sidebar: boolean;
  access: (session: PortalSession | null) => boolean;
  /** Narrower sidebar visibility when routes are reachable more broadly than the entry is shown. */
  sidebarAccess?: (session: PortalSession | null) => boolean;
  /**
   * Pages that live inside this section and are listed under it in the
   * sidebar while the reader is in it — the way a group's own pages appear
   * under Groups and fold away again when the reader leaves.
   */
  children?: readonly PortalSectionChild[];
}

/** A page inside a section, listed under it while that section is the one open. */
export interface PortalSectionChild {
  group?: string;
  path: string;
  label: string;
  access: (session: PortalSession | null) => boolean;
  /** One sentence for the section index; the sidebar shows the label alone. */
  description?: string;
}

const PORTAL_SECTIONS: readonly PortalSectionDef[] = [
  {
    section: "home",
    path: "/home",
    label: "Home",
    sidebar: true,
    access: (session) => Boolean(session?.member || session?.staff),
  },
  {
    section: "groups",
    path: "/groups",
    label: "Groups",
    sidebar: true,
    access: (session) => Boolean(session?.member || session?.staff),
  },
  {
    // Program-committee reviewers reach their proposal programs through the
    // Events domain even without a generic event grant.
    section: "events",
    path: "/events",
    label: "Events",
    sidebar: true,
    access: (session) =>
      Boolean(session?.eventParticipation) ||
      portalHasPermissionAtAnyScope(session, "events:read") ||
      portalHasPermissionAtAnyScope(session, "proposals:read"),
    children: [
      {
        path: "/events/analytics",
        label: "Analytics",
        access: (session) => portalHasGlobalPermission(session, "analytics:read"),
      },
    ],
  },
  {
    // Representatives reach their organizations from the avatar menu and the
    // Groups-style workspace routes; the sidebar entry is the directory for
    // identities with the global permissions.
    section: "organizations",
    path: "/organizations",
    label: "Organizations",
    sidebar: true,
    access: (session) =>
      Boolean(session?.member) || portalHasAnyGlobalPermission(session, ["organizations:read", "membership:write"]),
    sidebarAccess: (session) => portalHasAnyGlobalPermission(session, ["organizations:read", "membership:write"]),
    // Analytics live under the domain they measure (#39).
    children: [
      {
        path: "/organizations/analytics",
        label: "Analytics",
        access: (session) => portalHasGlobalPermission(session, "analytics:read"),
      },
    ],
  },
  {
    // The consortium's own roll — organizations' representatives and
    // individual members in one list. Distinct from Organizations, which is
    // the organization records themselves, and from the applications queue
    // below, which is the same subject before it became a membership.
    section: "members",
    path: "/members",
    label: "Members",
    sidebar: true,
    access: (session) => portalHasGlobalPermission(session, "membership:read"),
    children: [
      {
        path: "/members/analytics",
        label: "Analytics",
        access: (session) => portalHasGlobalPermission(session, "analytics:read"),
      },
    ],
  },
  {
    // Labeled for what it holds rather than for the domain it belongs to:
    // "Membership" beside "Members" told a reader nothing about which of the
    // two they wanted.
    section: "membership",
    path: "/membership/applications",
    label: "Applications",
    sidebar: true,
    access: (session) => portalHasGlobalPermission(session, "membership:read"),
  },
  {
    /*
     * One page for a person, whoever is looking. "My profile" is this section
     * too — a record about the reader, opened at their own id — so the routes
     * are reachable by anyone signed in, and the API decides what each caller
     * may actually read: yourself, or anybody with `users:read`.
     *
     * The sidebar entry stays the staff directory it always was. A member has
     * no list of everyone to browse, and offering them one would be a link to
     * a refusal.
     */
    section: "users",
    path: "/users",
    label: "Users",
    sidebar: true,
    access: (session) => Boolean(session?.identity.id) || portalHasGlobalPermission(session, "users:read"),
    sidebarAccess: (session) => portalHasGlobalPermission(session, "users:read"),
    children: [
      {
        path: "/users/analytics",
        label: "Analytics",
        access: (session) => portalHasGlobalPermission(session, "analytics:read"),
      },
    ],
  },
  {
    section: "donations",
    path: "/donations",
    label: "Donations",
    sidebar: true,
    access: (session) => portalHasAnyGlobalPermission(session, ["donations:read", "donations:sync"]),
    // The share-link leaderboard and the analytics are pages of their own, not
    // tabs above the donation list: each answers a different question, and a
    // reader who wants one of them should be able to see from the sidebar that
    // it exists and go straight there (#43).
    children: [
      {
        path: "/donations/promoters",
        label: "Share links",
        access: (session) => portalHasGlobalPermission(session, "donations:read"),
      },
      {
        path: "/donations/analytics",
        label: "Analytics",
        access: (session) => portalHasGlobalPermission(session, "analytics:read"),
      },
    ],
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
    // Participation records for any authenticated identity, member or not.
    section: "participation",
    path: "/participation",
    label: "My participation",
    sidebar: false,
    access: (session) =>
      Boolean(session?.member || session?.staff || session?.sponsors.length || session?.eventParticipation),
  },
  {
    // Superseded by the organization workspaces; the route redirects there.
    section: "organization",
    path: "/organization",
    label: "My Organization",
    sidebar: false,
    access: (session) => Boolean(session?.member),
  },
  {
    // Reached from the dashboard and the participation view, not the sidebar.
    section: "application",
    path: "/application",
    label: "My Application",
    sidebar: false,
    access: (session) => Boolean(session?.member),
  },
  {
    /*
     * Settings is a section of pages, not a page of sections.
     *
     * Every entry below used to be a tab on one hub, and "Membership
     * Settings" was a tab holding three unrelated subjects at once — the
     * workflow's deadlines, the form an applicant fills in, and the catalog
     * of categories — none of which could be linked to, headed itself, or
     * said in the address bar what the reader was looking at (#40). They are
     * pages, so they are declared as pages, and the sidebar lists them under
     * Settings the way it lists a group's pages under Groups.
     */
    section: "settings",
    path: "/settings",
    label: "Settings",
    sidebar: true,
    access: portalHasSettingsAccess,
    children: [
      {
        path: "/settings/application-workflow",
        group: "Membership",
        label: "Application workflow",
        description: "Review deadlines, and who is notified at each stage of a membership application.",
        access: (session) => portalHasGlobalPermission(session, "membership:read"),
      },
      {
        path: "/settings/applicant-reminders",
        group: "Membership",
        label: "Applicant reminders",
        description: "When an applicant on hold is reminded, and which addresses receive a copy.",
        access: (session) => portalHasGlobalPermission(session, "membership:read"),
      },
      {
        path: "/settings/membership-application-form",
        group: "Membership",
        label: "Membership application form",
        description: "The questions an applicant answers once their email address is verified.",
        access: (session) => portalHasGlobalPermission(session, "membership:read"),
      },
      {
        path: "/settings/membership-categories",
        group: "Membership",
        label: "Membership categories",
        description: "What each category is called, where it sits in the list, and whether it votes.",
        access: (session) => portalHasGlobalPermission(session, "membership:read"),
      },
      {
        path: "/settings/organization-content-reviews",
        label: "Content reviews",
        description: "Organization profile changes waiting for a decision.",
        access: (session) => portalHasGlobalPermission(session, "organizations:content-review"),
      },
      {
        path: "/settings/audit-log",
        label: "Audit log",
        description: "What the platform has recorded about who changed what, and when.",
        access: (session) => portalHasGlobalPermission(session, "audit:read"),
      },
      {
        path: "/settings/email-templates",
        label: "Email templates",
        description: "The messages the platform sends, and which version of each is live.",
        access: (session) => portalHasAnyGlobalPermission(session, ["email-templates:read", "email-templates:write"]),
      },
      {
        /*
         * The outbox, the due queue and the job registry were one "Operations"
         * tab — a bucket named after nothing a reader goes looking for, and
         * holding three subjects that each need a different grant. Each is a
         * page now, gated by the grant it actually needs.
         */
        path: "/settings/email-outbox",
        label: "Email outbox",
        description: "Mail the platform has queued, delivered, or failed to deliver.",
        access: (session) => portalHasGlobalPermission(session, "email:read"),
      },
      {
        path: "/settings/scheduled-work",
        label: "Scheduled work",
        description: "Retention and membership work that has fallen due.",
        access: (session) => portalHasGlobalPermission(session, "retention:read"),
      },
      {
        path: "/settings/scheduled-jobs",
        label: "Scheduled jobs",
        description: "The recurring jobs the platform runs, and whether each one is paused.",
        access: (session) => portalHasGlobalPermission(session, "scheduler:read"),
      },
      {
        path: "/settings/access-control",
        label: "Access control",
        description: "Which permissions are granted, the roles they come from, and who holds them.",
        access: (session) => portalHasAnyGlobalPermission(session, ["access:grant", "access:revoke"]),
      },
    ],
  },
  {
    section: "account",
    path: "/account",
    label: "Account Settings",
    sidebar: false,
    access: (session) =>
      Boolean(session?.member || session?.staff || session?.pendingIdentityCount || session?.eventParticipation),
  },
];

export const PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS = {
  "/working-groups": "/groups",
  "/calendar": "/groups",
} as const;

export interface PortalSupersededSettingsRoute {
  /** The old address, with the resource it carried as an optional segment. */
  from: string;
  /** Who may still follow it — the same rule that guards the destination. */
  access: (session: PortalSession | null) => boolean;
  /** Where the resource, or the collection without one, lives now. */
  to: (resourceId?: string) => string;
}

/**
 * Addresses the Settings shell used to own, and the business domains that
 * took them over.
 *
 * A table rather than a run of near-identical routes in the shell: each entry
 * is one fact about routing history, and the shell stays a readable list of
 * the addresses the portal actually has. Order is the router's — the donation
 * detail must be matched before the donations collection, which would
 * otherwise claim "detail" as a resource id.
 */
export const PORTAL_SUPERSEDED_SETTINGS_ROUTES: readonly PortalSupersededSettingsRoute[] = [
  {
    from: "/settings/users/:resourceId?",
    access: (session) => portalSectionEnabled(session, "users"),
    to: (resourceId) => (resourceId ? `/users/${encodeURIComponent(resourceId)}` : "/users"),
  },
  {
    from: "/settings/organizations/:resourceId?",
    access: (session) => portalHasAnyGlobalPermission(session, ["organizations:read", "membership:write"]),
    to: (resourceId) => (resourceId ? `/organizations/${encodeURIComponent(resourceId)}` : "/organizations"),
  },
  {
    from: "/settings/membership-applications/:resourceId?",
    access: (session) => portalSectionEnabled(session, "membership"),
    to: (resourceId) =>
      resourceId ? `/membership/applications/${encodeURIComponent(resourceId)}` : "/membership/applications",
  },
  {
    from: "/settings/donations/detail/:resourceId",
    access: (session) => portalSectionEnabled(session, "donations"),
    to: (resourceId) => `/donations/detail/${encodeURIComponent(resourceId ?? "")}`,
  },
  {
    from: "/settings/donations/:resourceId?",
    access: (session) => portalSectionEnabled(session, "donations"),
    to: (resourceId) => (resourceId ? `/donations/${encodeURIComponent(resourceId)}` : "/donations"),
  },
];

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
  // Every entry is its own root page, Settings included: a sidebar item that
  // names a section has to open that section, not whichever of its pages the
  // reader's grants happen to put first.
  return PORTAL_SECTIONS.filter((def) => def.sidebar && (def.sidebarAccess ?? def.access)(session)).map((def) => ({
    path: def.path,
    section: def.section,
    label: def.label,
  }));
}

export function portalDefaultPath(session: PortalSession | null): string {
  if (session?.member || session?.staff) return "/home";
  if (session?.eventParticipation) return "/events";
  if (session?.sponsors.length) return "/sponsors";
  if (session?.pendingIdentityCount) return "/account";
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

/** The pages listed under one section while it is the section being read. */
export function portalSectionChildren(section: string, session: PortalSession | null): PortalNavItem[] {
  const definition = PORTAL_SECTIONS.find((candidate) => candidate.section === section);
  return (definition?.children ?? [])
    .filter((child) => child.access(session))
    .map((child) => ({
      path: child.path,
      section,
      label: child.label,
      description: child.description,
      group: child.group,
    }));
}

export function portalActiveSection(location: string): string {
  const owner = portalSectionForLocation(location);
  if (owner) return owner.section;
  return location.replace(/^\//, "").split("/")[0] || "groups";
}
