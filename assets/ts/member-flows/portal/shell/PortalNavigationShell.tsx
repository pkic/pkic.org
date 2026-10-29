import { createPortal } from "preact/compat";
import { AccountMenu } from "../../../ui/AccountMenu";
import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";
import { Link } from "wouter";
import { usePortalHashLocation } from "../hash-location";
import { Alert } from "../../../ui/Alert";
import { HeadingOutline } from "../../../ui/HeadingOutline";
import { ButtonLink } from "../../../ui/Button";
import { IconMenu } from "../../../ui/MediaIcons";
import type { PortalSession } from "../types";
import {
  portalSidebarSection,
  portalNavigationItems,
  portalOwnUserRecordPath,
  portalSectionChildren,
  type PortalNavItem,
} from "./portal-navigation";
import { PortalNavigationIcon } from "./PortalNavigationIcon";
import { SidebarGroups } from "./SidebarGroups";
import { AppTabBar } from "./AppTabBar";
import { trackVisualViewportShift } from "../../../ui/visual-viewport-shift";
import "./PortalAppChrome.css";
import { portalAppTabForLocation, portalAppTabs } from "./portal-app-tabs";

function SettingsNavigation({
  items,
  location,
  onNavigate,
}: {
  items: PortalNavItem[];
  location: string;
  onNavigate: () => void;
}) {
  const ownsPage = (path: string) => location === path || location.startsWith(`${path}/`);
  const groups = [...new Set(items.map((item) => item.group))];
  const links = (children: PortalNavItem[]) =>
    children.map((child) => {
      const active = ownsPage(child.path);
      return (
        <li key={child.path}>
          <Link
            href={child.path}
            class={`portal-sidebar-group${active ? " active" : ""}`}
            aria-current={location === child.path ? "page" : active ? "location" : undefined}
            onClick={onNavigate}
          >
            <span class="portal-sidebar-group-name">{child.label}</span>
          </Link>
        </li>
      );
    });
  return (
    <>
      {groups.map((group) => {
        const children = items.filter((item) => item.group === group);
        return group ? (
          <li key={group}>
            <details open={children.some((child) => ownsPage(child.path))}>
              <summary class="portal-sidebar-group">{group}</summary>
              <ul class="portal-sidebar-groups" aria-label={`${group} settings`}>
                {links(children)}
              </ul>
            </details>
          </li>
        ) : (
          links(children)
        );
      })}
    </>
  );
}

interface PortalNavigationShellProps {
  children: ComponentChildren;
  displayName: string;
  headshotUrl: string | null;
  session: PortalSession | null;
}

export function PortalNavigationShell({ children, displayName, headshotUrl, session }: PortalNavigationShellProps) {
  const [location, navigate] = usePortalHashLocation();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem("portal-sidebar-collapsed") === "true";
    } catch {
      return false;
    }
  });
  function toggleSidebar() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    try {
      localStorage.setItem("portal-sidebar-collapsed", String(next));
    } catch {
      /* The current view still works without preference storage. */
    }
  }
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

  // The sticky top bar and the fixed bottom bar follow the area the reader can see (see visual-viewport-shift).
  useEffect(() => trackVisualViewportShift(), []);

  const activeSection = portalSidebarSection(location);
  const pendingIdentityCount = session?.pendingIdentityCount ?? 0;
  const ownRecordPath = portalOwnUserRecordPath(session);

  return (
    <div id="portal-root" class={sidebarCollapsed ? "portal-sidebar-collapsed" : undefined}>
      {session &&
        document.getElementById("pkic-account-menu") &&
        createPortal(
          <AccountMenu
            session={session}
            displayName={displayName}
            headshotUrl={headshotUrl}
            navigate={(path) => {
              closeNavigation();
              navigate(path);
            }}
          />,
          document.getElementById("pkic-account-menu")!,
        )}
      <div id="portal-topbar" data-sticky-header>
        <button
          id="portal-sidebar-toggle"
          type="button"
          aria-label={navigationOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={navigationOpen}
          aria-controls="portal-sidebar"
          onClick={() => setNavigationOpen((open) => !open)}
        >
          <IconMenu width="20" height="20" />
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
      {/*
        The portal renders inside the site document's one top-level <main>,
        so its own regions are not landmarks that compete with it: the sidebar
        is the portal's navigation, and the content column below is a plain
        container. A <main> or <aside> here would nest a landmark inside
        <main> (WCAG 1.3.1).
      */}
      <nav id="portal-sidebar" class={navigationOpen ? "open" : undefined} aria-label="Portal navigation">
        <div class="portal-sidebar-heading">
          <button
            class="portal-sidebar-collapse"
            type="button"
            aria-label={sidebarCollapsed ? "Expand main menu" : "Collapse main menu"}
            title={sidebarCollapsed ? "Expand main menu" : "Collapse main menu"}
            aria-expanded={!sidebarCollapsed}
            aria-controls="portal-sidebar"
            onClick={toggleSidebar}
          >
            <IconMenu width="20" height="20" />
          </button>
          <div class="portal-sidebar-brand">
            <div class="portal-brand">PKI Consortium Portal</div>
          </div>
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
                aria-label={item.label}
                title={item.label}
                aria-current={location === item.path ? "page" : undefined}
                onClick={closeNavigation}
              >
                <span class="portal-sidebar-icon">
                  <PortalNavigationIcon section={item.section} />
                </span>
                <span class="portal-sidebar-label">{item.label}</span>
              </Link>
              {open && item.section === "groups" && <SidebarGroups session={session} onNavigate={closeNavigation} />}
              {children.length > 0 && (
                <ul class="portal-sidebar-groups" aria-label={`${item.label} pages`}>
                  <SettingsNavigation items={children} location={location} onNavigate={closeNavigation} />
                </ul>
              )}
            </div>
          );
        })}
      </nav>
      <div id="portal-main">
        {pendingIdentityCount > 0 && ownRecordPath !== null && location !== ownRecordPath && (
          <div class="pk portal-identity-invitation">
            <Alert tone="info" title="Identity invitation">
              <p>
                You have{" "}
                {pendingIdentityCount === 1 ? "an identity invitation" : `${pendingIdentityCount} identity invitations`}{" "}
                waiting for review.
              </p>
              <ButtonLink href={usePortalHashLocation.hrefs(ownRecordPath)} variant="primary">
                Review {pendingIdentityCount === 1 ? "invitation" : "invitations"}
              </ButtonLink>
            </Alert>
          </div>
        )}
        {/* Each screen's title is the document's one <h1>; its sections step down from there. */}
        <HeadingOutline titleLevel={1}>{children}</HeadingOutline>
      </div>
      <AppTabBar
        scope="portal"
        label="App"
        items={portalAppTabs(session)}
        activeId={portalAppTabForLocation(session, location)}
      />
    </div>
  );
}
