import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { usePortalHashLocation } from "../hash-location";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { userOrganizationsListResponseSchema } from "../../../../shared/schemas/user-organizations";
import { Menu } from "../../../ui/Menu";
import { MenuIcon } from "../../../components/MenuIcon";
import { useData } from "../../../hooks/useData";
import { getJson, postJson } from "../../../shared/api-client";
import { clearAuth } from "../state";
import type { PortalSession } from "../types";
import { portalActiveSection, portalNavigationItems, portalSectionEnabled } from "./portal-navigation";
import { SidebarGroups } from "./SidebarGroups";

interface PortalNavigationShellProps {
  children: ComponentChildren;
  displayName: string;
  headshotUrl: string | null;
  session: PortalSession | null;
}

/** First letters of the first two name words; falls back to the first character. */
import { personInitials } from "../../../components/PersonCell";

/** Kept as the shell-local name; the shared implementation lives in PersonCell. */
export const portalAvatarInitials = personInitials;

export function PortalNavigationShell({ children, displayName, headshotUrl, session }: PortalNavigationShellProps) {
  const [location, navigate] = usePortalHashLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
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
  const closeNavigation = () => setNavigationOpen(false);

  // Attach once and test the state inside, rather than attaching only while
  // the drawer is open. Effects run after paint, so the open drawer is on
  // screen for a frame before its own Escape listener exists — an Escape
  // pressed in that window was silently dropped, leaving the drawer stuck
  // open for anyone quick or driving the portal from the keyboard.
  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavigationOpen((open) => {
        if (!open) return open;
        event.preventDefault();
        document.getElementById("portal-sidebar-toggle")?.focus();
        return false;
      });
    };

    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, []);

  async function signOut(): Promise<void> {
    setSignOutError(null);
    try {
      if (session) await postJson("/api/v1/auth/logout", {}, successResponseSchema);
      clearAuth();
      window.location.assign("/portal/");
    } catch {
      setSignOutError("Sign out failed. Your session is still active; please try again.");
    }
  }

  const activeSection = portalActiveSection(location);

  return (
    <div id="portal-root">
      <div id="portal-topbar">
        <button
          id="portal-sidebar-toggle"
          type="button"
          aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navigationOpen}
          aria-controls="portal-sidebar"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <MenuIcon />
        </button>
        <span class="portal-brand">PKI Consortium Portal</span>
      </div>
      <button
        id="portal-sidebar-backdrop"
        type="button"
        class={navigationOpen ? "active" : ""}
        aria-label="Close navigation"
        onClick={closeNavigation}
      />
      <aside id="portal-sidebar" class={`p-2${navigationOpen ? " open" : ""}`} aria-label="Portal navigation">
        <div class="px-2 py-3 mb-1">
          <div class="portal-brand">PKI Consortium Portal</div>
        </div>
        {portalNavigationItems(session).map((item) => (
          <div key={item.section}>
            <Link
              href={item.path}
              class={`portal-sidebar-link${item.section === activeSection ? " active" : ""}`}
              onClick={closeNavigation}
            >
              {item.label}
            </Link>
            {item.section === "groups" && <SidebarGroups session={session} onNavigate={closeNavigation} />}
          </div>
        ))}
        <div class="portal-sidebar-footer px-1 pt-3">
          {signOutError && <div class="alert alert-danger small">{signOutError}</div>}
          {/* The trigger is a person, not an icon, so the menu renders it
              plain and the sidebar's own class styles the content inside. */}
          <Menu
            label="Account menu"
            variant="plain"
            items={[
              ...(portalSectionEnabled(session, "profile")
                ? [
                    {
                      id: "profile",
                      label: "My profile",
                      onSelect: () => {
                        closeNavigation();
                        navigate("/profile");
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
              ...(portalSectionEnabled(session, "participation")
                ? [
                    {
                      id: "participation",
                      label: "My participation",
                      onSelect: () => {
                        closeNavigation();
                        navigate("/participation");
                      },
                    },
                  ]
                : []),
              ...(portalSectionEnabled(session, "account")
                ? [
                    {
                      id: "account",
                      label: "Account settings",
                      onSelect: () => {
                        closeNavigation();
                        navigate("/account");
                      },
                    },
                  ]
                : []),
              { id: "sign-out", label: "Sign out", onSelect: () => void signOut() },
            ]}
          >
            <span class="portal-sidebar-user">
              <span class="portal-user-avatar" aria-hidden="true">
                {headshotUrl ? <img src={headshotUrl} alt="" /> : portalAvatarInitials(displayName)}
              </span>
              <span class="portal-user-name">{displayName || "Account"}</span>
            </span>
          </Menu>
        </div>
      </aside>
      <main id="portal-main">{children}</main>
    </div>
  );
}
