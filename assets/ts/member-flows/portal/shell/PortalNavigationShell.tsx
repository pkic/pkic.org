import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { successResponseSchema } from "../../../../shared/schemas/api-common";
import { MenuIcon } from "../../../components/MenuIcon";
import { postJson } from "../../../shared/api-client";
import { clearAuth } from "../state";
import type { PortalSession } from "../types";
import { portalActiveSection, portalNavigationItems } from "./portal-navigation";

interface PortalNavigationShellProps {
  children: ComponentChildren;
  displayName: string;
  session: PortalSession | null;
}

export function PortalNavigationShell({ children, displayName, session }: PortalNavigationShellProps) {
  const [location] = useHashLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const closeNavigation = () => setNavigationOpen(false);

  useEffect(() => {
    if (!navigationOpen) return;

    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setNavigationOpen(false);
      document.getElementById("portal-sidebar-toggle")?.focus();
    };

    document.addEventListener("keydown", closeWithEscape);
    return () => document.removeEventListener("keydown", closeWithEscape);
  }, [navigationOpen]);

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
          <div id="portal-sb-user">{displayName}</div>
        </div>
        {portalNavigationItems(session).map((item) => (
          <Link
            key={item.section}
            href={item.path}
            class={`portal-sidebar-link${item.section === portalActiveSection(location, session) ? " active" : ""}`}
            onClick={closeNavigation}
          >
            {item.label}
          </Link>
        ))}
        <div class="portal-sidebar-footer px-1 pt-3">
          {signOutError && <div class="alert alert-danger small">{signOutError}</div>}
          <button
            type="button"
            class="btn btn-sm btn-outline-secondary w-100"
            disabled={signingOut}
            onClick={async () => {
              setSignOutError(null);
              setSigningOut(true);
              try {
                await postJson("/api/v1/auth/logout", {}, successResponseSchema);
                clearAuth();
                window.location.assign("/portal/");
              } catch {
                setSignOutError("Sign out failed. Your session is still active; please try again.");
              } finally {
                setSigningOut(false);
              }
            }}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </aside>
      <main id="portal-main">{children}</main>
    </div>
  );
}
