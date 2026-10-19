import { useState } from "preact/hooks";
import { userOrganizationsListResponseSchema } from "../../shared/schemas/user-organizations";
import { Alert } from "./Alert";
import { Avatar } from "./Avatar";
import { Menu } from "./Menu";
import { useData } from "../hooks/useData";
import { getJson } from "../shared/api-client";
import { signOutPortalSession } from "../member-flows/portal/logout-session";
import type { PortalSession } from "../member-flows/portal/types";
import { portalDefaultPath } from "../member-flows/portal/shell/portal-navigation";
import { useActingIdentityMenu } from "../member-flows/portal/shell/ActingIdentitySwitcher";
import "./AccountMenu.css";

export function AccountMenu({
  session,
  displayName,
  headshotUrl,
  navigate,
  onNavigate = () => {},
}: {
  session: PortalSession;
  displayName: string;
  headshotUrl: string | null;
  navigate: (path: string) => void;
  onNavigate?: () => void;
}) {
  // The identity's organizations live in the account menu, not the sidebar:
  // each one deep-links into its organization workspace.
  const organizations = useData(
    () =>
      session?.member
        ? getJson("/api/v1/users/current/organizations?limit=12", userOrganizationsListResponseSchema)
        : Promise.resolve(null),
    [Boolean(session?.member)],
  );
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const actingIdentityMenu = useActingIdentityMenu(session);
  const closeNavigation = onNavigate;

  async function signOut(): Promise<void> {
    setSignOutError(null);
    try {
      if (session) await signOutPortalSession(session);
      closeNavigation();
    } catch {
      setSignOutError("Local sign-out could not be saved. Keep this page open and try again.");
    }
  }

  return (
    <div class="pk pk-account-menu">
      {(signOutError ?? actingIdentityMenu.error) && (
        <Alert tone="danger">{signOutError ?? actingIdentityMenu.error}</Alert>
      )}
      <Menu
        label="Account menu"
        variant="plain"
        align="end"
        heading={actingIdentityMenu.heading}
        items={[
          {
            id: "portal",
            label: "Portal",
            onSelect: () => {
              closeNavigation();
              navigate(portalDefaultPath(session));
            },
          },
          /*
           * "My profile" is the reader's own user record: their names,
           * identities, addresses and access. The public profile is reached
           * from that record's menu as "View public profile".
           */
          ...(session
            ? [
                {
                  id: "profile",
                  label: "My profile",
                  onSelect: () => {
                    closeNavigation();
                    navigate(`/users/${encodeURIComponent(session.identity.id)}`);
                  },
                },
                {
                  id: "applications",
                  label: "My applications",
                  onSelect: () => {
                    closeNavigation();
                    navigate("/application");
                  },
                },
              ]
            : []),
          ...(organizations.data?.organizations ?? []).map((organization) => ({
            id: `organization-${organization.organizationId}`,
            label: organization.name,
            onSelect: () => {
              closeNavigation();
              navigate(`/organizations/${encodeURIComponent(organization.organizationId)}`);
            },
          })),
          ...actingIdentityMenu.items,
          { id: "sign-out", label: "Sign out", onSelect: () => void signOut() },
        ]}
      >
        <Avatar name={displayName || "Account"} src={headshotUrl ?? undefined} />
      </Menu>
    </div>
  );
}
