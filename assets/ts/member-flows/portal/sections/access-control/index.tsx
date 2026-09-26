import { BreadcrumbScope } from "../../../../ui/BreadcrumbScope";
import { useEffect } from "preact/hooks";

import { usePortalHashLocation } from "../../hash-location";
import { Tabs } from "../../../../components/Tabs";
import { PageHeader } from "../../../../ui/PageHeader";
import { Grants } from "./Grants";
import { Roles } from "./Roles";
import { UserRoles } from "./UserRoles";

const TABS = [
  { key: "grants", label: "Access Grants" },
  { key: "roles", label: "Roles" },
  { key: "people", label: "People" },
];

/** `resourceId` segment prefixes that route into a tab's own sub-view — see resolveAccessControlTab. */
const ROLE_DETAIL_PREFIX = "roles/";
const GRANT_DETAIL_PREFIX = "grants/";

/**
 * Resolves the canonical `/settings/access-control/:tab` sub-tab (and, for the
 * Roles tab, an optional `roleId`/`"new"` segment) from the `resourceId`
 * PortalShell hands down. An unrecognized value falls back to the default
 * "grants" tab instead of rendering nothing.
 */
function resolveAccessControlTab(resourceId?: string): { tab: string; roleSegment?: string; grantSegment?: string } {
  if (resourceId?.startsWith(ROLE_DETAIL_PREFIX)) {
    return { tab: "roles", roleSegment: resourceId.slice(ROLE_DETAIL_PREFIX.length) };
  }
  if (resourceId?.startsWith(GRANT_DETAIL_PREFIX)) {
    return { tab: "grants", grantSegment: resourceId.slice(GRANT_DETAIL_PREFIX.length) };
  }
  if (resourceId && TABS.some((item) => item.key === resourceId)) {
    return { tab: resourceId };
  }
  return { tab: "grants" };
}

/**
 * Portal UI for global access-control administration.
 *
 * Group management and leadership use each group's own contextual views. They
 * are day-to-day group responsibilities, not global access-control settings,
 * and therefore do not belong in this System destination.
 */
export function AccessControl({
  canGrant = true,
  canRevoke = true,
  resourceId,
}: {
  canGrant?: boolean;
  canRevoke?: boolean;
  resourceId?: string;
} = {}) {
  const [, navigate] = usePortalHashLocation();
  const { tab, roleSegment, grantSegment } = resolveAccessControlTab(resourceId);

  /**
   * Every tab here is a place, and each one navigates to `/settings/access-control/:tab`
   * when it is chosen. The sidebar's own entry points at the bare section path,
   * though, so arriving from navigation left the default tab showing at an
   * address that named no tab: the same view under two URLs, only one of which
   * a reader could share back. Rewriting the entry — replacing, so Back still
   * leaves the section — gives the visible tab and the address bar one answer.
   */
  useEffect(() => {
    if (resourceId) return;
    /*
     * Only while this section is still the address. The effect runs after the
     * render that mounted it, which can be a render the reader has already
     * navigated away from — and replacing the URL then drags them back here
     * from wherever they went. Two runs in three of the group-roster spec
     * landed on this page for exactly that reason.
     */
    if (!window.location.hash.startsWith("#/settings/access-control")) return;
    navigate(`/settings/access-control/${tab}`, { replace: true });
  }, [resourceId, tab, navigate]);

  return (
    // One page with three views of one subject — who holds what — so the
    // strip stays and the page heads itself above it. That is the difference
    // between this and the Settings hub the strip was removed from: these
    // tabs are facets of a single thing, not separate settings pages.
    <div class="pk pk-stack">
      <BreadcrumbScope
        route={resourceId ?? "grants"}
        label="Access control navigation"
        items={[
          { label: "Settings", href: usePortalHashLocation.hrefs("/settings") },
          { label: "Access control", href: usePortalHashLocation.hrefs("/settings/access-control") },
          {
            label: TABS.find((item) => item.key === tab)?.label ?? tab,
            href: usePortalHashLocation.hrefs(`/settings/access-control/${tab}`),
          },
        ]}
      >
        <PageHeader title="Access control" />
        <Tabs
          items={TABS}
          active={tab}
          label="Access control sections"
          onChange={(key) => navigate(`/settings/access-control/${key}`)}
          hrefFor={(key) => `/settings/access-control/${key}`}
        />
        {tab === "grants" && (
          <Grants
            canGrant={canGrant}
            canRevoke={canRevoke}
            grantSegment={grantSegment}
            onNavigate={(segment) =>
              navigate(segment ? `/settings/access-control/grants/${segment}` : "/settings/access-control/grants")
            }
          />
        )}
        {tab === "roles" && (
          <Roles
            canGrant={canGrant}
            canRevoke={canRevoke}
            roleSegment={roleSegment}
            onNavigate={(segment) =>
              navigate(segment ? `/settings/access-control/roles/${segment}` : "/settings/access-control/roles")
            }
          />
        )}
        {tab === "people" && <UserRoles canGrant={canGrant} canRevoke={canRevoke} />}
      </BreadcrumbScope>
    </div>
  );
}
