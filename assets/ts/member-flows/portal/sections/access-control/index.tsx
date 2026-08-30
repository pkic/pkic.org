import { useHashLocation } from "wouter/use-hash-location";
import { Tabs } from "../../../../components/Tabs";
import { Grants } from "./Grants";
import { Roles } from "./Roles";
import { UserRoles } from "./UserRoles";

const TABS = [
  { key: "grants", label: "Access Grants" },
  { key: "roles", label: "Roles" },
  { key: "people", label: "People" },
];

/** `resourceId` segment prefix that routes into a specific role's detail — see resolveAccessControlTab. */
const ROLE_DETAIL_PREFIX = "roles/";

/**
 * Resolves the canonical `/system/access-control/:tab` sub-tab (and, for the
 * Roles tab, an optional `roleId`/`"new"` segment) from the `resourceId`
 * PortalShell hands down. An unrecognized value falls back to the default
 * "grants" tab instead of rendering nothing.
 */
function resolveAccessControlTab(resourceId?: string): { tab: string; roleSegment?: string } {
  if (resourceId?.startsWith(ROLE_DETAIL_PREFIX)) {
    return { tab: "roles", roleSegment: resourceId.slice(ROLE_DETAIL_PREFIX.length) };
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
  const [, navigate] = useHashLocation();
  const { tab, roleSegment } = resolveAccessControlTab(resourceId);

  return (
    <div>
      <Tabs items={TABS} active={tab} onChange={(key) => navigate(`/system/access-control/${key}`)} />
      {tab === "grants" && <Grants canGrant={canGrant} canRevoke={canRevoke} />}
      {tab === "roles" && (
        <Roles
          canGrant={canGrant}
          canRevoke={canRevoke}
          roleSegment={roleSegment}
          onNavigate={(segment) =>
            navigate(segment ? `/system/access-control/roles/${segment}` : "/system/access-control/roles")
          }
        />
      )}
      {tab === "people" && <UserRoles canGrant={canGrant} canRevoke={canRevoke} />}
    </div>
  );
}
