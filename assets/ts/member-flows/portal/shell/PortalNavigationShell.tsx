import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { Menu } from "../../../components/Menu";
import { MenuIcon } from "../../../components/MenuIcon";
import { postJson } from "../../../shared/api-client";
import { clearAuth } from "../state";
import type { PortalSession } from "../types";
import { portalActiveSection, portalNavigationItems, portalSectionEnabled } from "./portal-navigation";
import { SidebarGroups } from "./SidebarGroups";

interface PortalNavigationShellProps {
  children: ComponentChildren;
  displayName: string;
  session: PortalSession | null;
}

export function PortalNavigationShell({ children, displayName, session }: PortalNavigationShellProps) {
  const [location, navigate] = useHashLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
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
          <Menu
            label="Account menu"
            buttonClass="portal-sidebar-user"
            buttonContent={displayName || "Account"}
            actions={[
              ...(portalSectionEnabled(session, "account")
                ? [
                    {
                      key: "account",
                      label: "Account settings",
                      onSelect: () => {
                        closeNavigation();
                        navigate("/account");
                      },
                    },
                  ]
                : []),
              { key: "sign-out", label: "Sign out", onSelect: () => void signOut() },
            ]}
          />
        </div>
      </aside>
      <main id="portal-main">{children}</main>
    </div>
  );
}
