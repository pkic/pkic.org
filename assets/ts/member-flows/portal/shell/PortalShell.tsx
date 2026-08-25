/** Capability-derived portal shell shared by member and management identities. */
import { type ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { portalSession, profile } from "../state";
import { MyProfile } from "../sections/MyProfile";
import { MyOrganization } from "../sections/MyOrganization";
import { Groups } from "../sections/Groups";
import { Votes } from "../sections/Votes";
import { MyApplications } from "../sections/MyApplications";
import { AccountSettings } from "../sections/AccountSettings";
import { Management } from "../sections/management/Management";
import type { PortalSession } from "../types";
import { PortalNavigationShell } from "./PortalNavigationShell";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  portalCapacityFallbackPath,
  portalDefaultPath,
} from "./portal-navigation";

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

function PortalRouteRedirect({ to }: { to: string }) {
  const [, navigate] = useHashLocation();
  useEffect(() => navigate(to), [navigate, to]);
  return null;
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
          {(hasAdminCapacity || hasMemberCapacity) && (
            <Route
              path="/groups/:groupId/:view?"
              component={({ params }: { params: { groupId: string; view?: string } }) => (
                <SectionWrapper title="Group">
                  <Management groupId={params.groupId} view={params.view} />
                </SectionWrapper>
              )}
            />
          )}
          {hasAdminCapacity && (
            <Route
              path="/management/:groupId/:view?"
              component={({ params }: { params: { groupId: string; view?: string } }) => (
                <PortalRouteRedirect
                  to={`/groups/${encodeURIComponent(params.groupId)}/${encodeURIComponent(params.view ?? "overview")}`}
                />
              )}
            />
          )}
          {hasAdminCapacity && (
            <Route
              path="/management"
              component={() => (
                <SectionWrapper title="Management">
                  <Management />
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
              path="/groups"
              component={() => (
                <SectionWrapper title="Groups">
                  <Groups />
                </SectionWrapper>
              )}
            />
          )}
          {hasMemberCapacity &&
            Object.entries(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS).map(([from, to]) => (
              <Route key={from} path={from} component={() => <PortalRouteRedirect to={to} />} />
            ))}
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
