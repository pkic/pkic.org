import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { usePortalHashLocation } from "../hash-location";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { userOrganizationsListResponseSchema } from "../../../../shared/schemas/user-organizations";
import { Alert } from "../../../ui/Alert";
import { Menu } from "../../../ui/Menu";
import { MenuIcon } from "../../../components/MenuIcon";
import { useData } from "../../../hooks/useData";
import { getJson, postJson } from "../../../shared/api-client";
import { clearAuth } from "../state";
import type { PortalSession } from "../types";
import {
  portalActiveSection,
  portalNavigationItems,
  portalSectionChildren,
  portalSectionEnabled,
} from "./portal-navigation";
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
      <aside id="portal-sidebar" class={navigationOpen ? "open" : undefined} aria-label="Portal navigation">
        <div class="portal-sidebar-brand">
          <div class="portal-brand">PKI Consortium Portal</div>
        </div>
        {portalNavigationItems(session).map((item) => {
          /*
           * A section's own pages are listed under it while it is the one
           * being read, and fold away when the reader moves to another —
           * which is what the groups list has always done, and what the rest
           * of the sidebar now does too. Showing every section's pages at
           * once would be a menu the length of the application.
           */
          const open = item.section === activeSection;
          const children = open ? portalSectionChildren(item.section, session) : [];
          return (
            <div key={item.section}>
              {/*
                "Open" and "current" are two different facts: a section stays
                open while the reader is anywhere inside it, but only the entry
                whose address is the one being read is the current page. The
                Settings tab strip used to carry that mark; with the pages
                listed here instead, the sidebar owes it.
              */}
              <Link
                href={item.path}
                class={`portal-sidebar-link${open ? " active" : ""}`}
                aria-current={location === item.path ? "page" : undefined}
                onClick={closeNavigation}
              >
                {item.label}
              </Link>
              {open && item.section === "groups" && <SidebarGroups session={session} onNavigate={closeNavigation} />}
              {children.length > 0 && (
                <ul class="portal-sidebar-groups" aria-label={`${item.label} pages`}>
                  {children.map((child) => (
                    <li key={child.path}>
                      <Link
                        href={child.path}
                        class={`portal-sidebar-group${location === child.path ? " active" : ""}`}
                        aria-current={location === child.path ? "page" : undefined}
                        onClick={closeNavigation}
                      >
                        <span class="portal-sidebar-group-name">{child.label}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        <div class="portal-sidebar-footer">
          {signOutError && (
            <div class="pk">
              <Alert tone="danger">{signOutError}</Alert>
            </div>
          )}
          {/* The trigger is a person, not an icon, so the menu renders it
              plain and the sidebar's own class styles the content inside. */}
          <Menu
            label="Account menu"
            variant="plain"
            items={[
              /*
               * "My profile" is the reader's own user record, at the same
               * address anybody else's record has. There is no separate self
               * page to keep in step with it, and the record it opens gains
               * the self-only affordances rather than duplicating them.
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
