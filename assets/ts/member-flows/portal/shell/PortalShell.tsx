/**
 * Member portal nav shell (Member Portal Navigation Structure).
 * Mirrors the admin SPA's shell shape (Topbar + Sidebar + hash
 * router) at a much smaller scale — seven top-level sections, three of
 * which are functional in this phase (My Profile, My Application, Account
 * Settings); the rest render a "coming soon" placeholder naming the future
 * UI phase that builds them.
 */
import { type ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { Router, Route, Switch, Link } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { profile, clearAuth } from "../state";
import { MyProfile } from "../sections/MyProfile";
import { MyOrganization } from "../sections/MyOrganization";
import { WorkingGroups } from "../sections/WorkingGroups";
import { Calendar } from "../sections/Calendar";
import { Votes } from "../sections/Votes";
import { MyApplications } from "../sections/MyApplications";
import { AccountSettings } from "../sections/AccountSettings";

interface NavItem {
  path: string;
  sec: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/profile", sec: "profile", label: "My Profile" },
  { path: "/organization", sec: "organization", label: "My Organization" },
  { path: "/working-groups", sec: "working-groups", label: "Working Groups" },
  { path: "/calendar", sec: "calendar", label: "Calendar" },
  { path: "/votes", sec: "votes", label: "Votes" },
  { path: "/application", sec: "application", label: "My Application" },
  { path: "/account", sec: "account", label: "Account Settings" },
];

function closeSidebar(): void {
  document.getElementById("portal-sidebar")?.classList.remove("open");
  document.getElementById("portal-sidebar-backdrop")?.classList.remove("active");
  document.getElementById("portal-sidebar-toggle")?.setAttribute("aria-expanded", "false");
}

function toggleSidebar(): void {
  const sidebar = document.getElementById("portal-sidebar");
  const backdrop = document.getElementById("portal-sidebar-backdrop");
  const toggle = document.getElementById("portal-sidebar-toggle");
  const isOpen = sidebar?.classList.toggle("open");
  backdrop?.classList.toggle("active", Boolean(isOpen));
  toggle?.setAttribute("aria-expanded", String(Boolean(isOpen)));
}

function activeSectionFor(location: string): string {
  const top = location.replace(/^\//, "").split("/")[0];
  return top || "profile";
}

function Sidebar() {
  const [location] = useHashLocation();
  const activeSec = activeSectionFor(location);
  const displayName =
    profile.value?.preferredName ||
    [profile.value?.firstName, profile.value?.lastName].filter(Boolean).join(" ").trim() ||
    profile.value?.email ||
    "";

  return (
    <aside id="portal-sidebar" class="p-2">
      <div class="px-2 py-3 mb-1">
        <div class="portal-brand">Member Portal</div>
        <div id="portal-sb-user">{displayName}</div>
      </div>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.sec}
          href={item.path}
          class={`portal-sidebar-link${item.sec === activeSec ? " active" : ""}`}
          onClick={closeSidebar}
        >
          {item.label}
        </Link>
      ))}
      <div class="portal-sidebar-footer px-1 pt-3">
        <button
          class="btn btn-sm btn-outline-secondary w-100"
          onClick={async () => {
            try {
              await fetch("/api/v1/auth/member/logout", { method: "POST", credentials: "same-origin" });
            } finally {
              clearAuth();
              window.location.assign("/portal/");
            }
          }}
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}

function Topbar() {
  useEffect(() => {
    const backdrop = document.getElementById("portal-sidebar-backdrop");
    backdrop?.addEventListener("click", closeSidebar);
    return () => backdrop?.removeEventListener("click", closeSidebar);
  }, []);

  return (
    <div id="portal-topbar">
      <button
        id="portal-sidebar-toggle"
        aria-label="Toggle navigation"
        aria-expanded="false"
        aria-controls="portal-sidebar"
        onClick={toggleSidebar}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" fill="currentColor" viewBox="0 0 16 16">
          <path
            fill-rule="evenodd"
            d="M2.5 12a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5m0-4a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 0 1H3a.5.5 0 0 1-.5-.5"
          />
        </svg>
      </button>
      <span class="portal-brand">Member Portal</span>
    </div>
  );
}

function SectionWrapper({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="portal-section">
      <h4 class="portal-section-title">{title}</h4>
      {children}
    </div>
  );
}

export function PortalShell() {
  return (
    <Router hook={useHashLocation}>
      <div id="portal-root">
        <Topbar />
        <div id="portal-sidebar-backdrop" />
        <Sidebar />
        <main id="portal-main">
          <Switch>
            <Route
              path="/profile"
              component={() => (
                <SectionWrapper title="My Profile">
                  <MyProfile />
                </SectionWrapper>
              )}
            />
            <Route
              path="/organization"
              component={() => (
                <SectionWrapper title="My Organization">
                  <MyOrganization />
                </SectionWrapper>
              )}
            />
            <Route
              path="/working-groups"
              component={() => (
                <SectionWrapper title="Working Groups">
                  <WorkingGroups />
                </SectionWrapper>
              )}
            />
            <Route
              path="/calendar"
              component={() => (
                <SectionWrapper title="Calendar">
                  <Calendar />
                </SectionWrapper>
              )}
            />
            <Route
              path="/votes"
              component={() => (
                <SectionWrapper title="Votes">
                  <Votes />
                </SectionWrapper>
              )}
            />
            <Route
              path="/application"
              component={() => (
                <SectionWrapper title="My Application">
                  <MyApplications />
                </SectionWrapper>
              )}
            />
            <Route
              path="/account"
              component={() => (
                <SectionWrapper title="Account Settings">
                  <AccountSettings />
                </SectionWrapper>
              )}
            />
            <Route path="/">
              {() => {
                window.location.hash = "#/profile";
                return null;
              }}
            </Route>
            <Route component={() => <div class="p-4 text-muted fst-italic">Section not found.</div>} />
          </Switch>
        </main>
      </div>
    </Router>
  );
}
