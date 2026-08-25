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
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { portalSession, profile } from "../state";
import { MyProfile } from "../sections/MyProfile";
import { MyOrganization } from "../sections/MyOrganization";
import { WorkingGroups } from "../sections/WorkingGroups";
import { Calendar } from "../sections/Calendar";
import { Votes } from "../sections/Votes";
import { MyApplications } from "../sections/MyApplications";
import { AccountSettings } from "../sections/AccountSettings";
import type { PortalSession } from "../types";
import { PortalNavigationShell } from "./PortalNavigationShell";
import { portalCapacityFallbackPath, portalDefaultPath } from "./portal-navigation";

function SectionWrapper({ title, children }: { title: string; children: ComponentChildren }) {
  return (
    <div class="portal-section">
      <h4 class="portal-section-title">{title}</h4>
      {children}
    </div>
  );
}

function PortalRouteFallback({ session }: { session: PortalSession | null }) {
  const [location, navigate] = useHashLocation();
  const fallbackPath = portalCapacityFallbackPath(session, location);

  useEffect(() => {
    if (fallbackPath) navigate(fallbackPath);
  }, [fallbackPath, navigate]);

  if (fallbackPath) return null;
  return <div class="p-4 text-muted fst-italic">Section not found.</div>;
}

export function PortalShell() {
  const hasMemberCapacity = Boolean(portalSession.value?.member);
  const hasAdminCapacity = Boolean(portalSession.value?.admin);
  const defaultPath = portalDefaultPath(portalSession.value);
  const displayName =
    profile.value?.preferredName ||
    [profile.value?.firstName, profile.value?.lastName].filter(Boolean).join(" ").trim() ||
    profile.value?.email ||
    portalSession.value?.identity.email ||
    "";
  return (
    <Router hook={useHashLocation}>
      <PortalNavigationShell session={portalSession.value} displayName={displayName}>
        <Switch>
          {hasAdminCapacity && (
            <Route
              path="/management"
              component={() => (
                <SectionWrapper title="Management">
                  <div class="alert alert-info">
                    Your management access is active. Group-scoped management views will appear here as they move into
                    the unified portal.
                  </div>
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity && (
            <Route
              path="/profile"
              component={() => (
                <SectionWrapper title="My Profile">
                  <MyProfile />
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity && (
            <Route
              path="/organization"
              component={() => (
                <SectionWrapper title="My Organization">
                  <MyOrganization />
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity && (
            <Route
              path="/working-groups"
              component={() => (
                <SectionWrapper title="Working Groups">
                  <WorkingGroups />
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity && (
            <Route
              path="/calendar"
              component={() => (
                <SectionWrapper title="Calendar">
                  <Calendar />
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity && (
            <Route
              path="/votes"
              component={() => (
                <SectionWrapper title="Votes">
                  <Votes />
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity && (
            <Route
              path="/application"
              component={() => (
                <SectionWrapper title="My Application">
                  <MyApplications />
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity && (
            <Route
              path="/account"
              component={() => (
                <SectionWrapper title="Account Settings">
                  <AccountSettings />
                </SectionWrapper>
              )}
            />
          )}
          <Route path="/">
            {() => {
              window.location.hash = `#${defaultPath}`;
              return null;
            }}
          </Route>
          <Route component={() => <PortalRouteFallback session={portalSession.value} />} />
        </Switch>
      </PortalNavigationShell>
    </Router>
  );
}
