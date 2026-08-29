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
import { Forms } from "../sections/Forms";
import { SystemManagement } from "../sections/SystemManagement";
import { Management } from "../sections/management/Management";
import { GroupEventProposals } from "../sections/management/GroupEventProposals";
import { DonationDetailPage } from "../sections/system-donations/DonationDetailPage";
import type { PortalSession } from "../types";
import { PortalNavigationShell } from "./PortalNavigationShell";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  portalCapacityFallbackPath,
  portalDefaultPath,
  portalHasGlobalPermission,
  portalHasSystemManagement,
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
  const hasAdminCapacity = Boolean(portalSession.value?.staff);
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
          {portalHasGlobalPermission(portalSession.value, "forms:read") && (
            <Route
              path="/forms/:formKey"
              component={({ params }: { params: { formKey: string } }) => (
                <SectionWrapper title="Forms">
                  <Forms
                    formKey={params.formKey}
                    canWrite={portalHasGlobalPermission(portalSession.value, "forms:write")}
                  />
                </SectionWrapper>
              )}
            />
          )}
          {portalHasGlobalPermission(portalSession.value, "forms:read") && (
            <Route
              path="/forms"
              component={() => (
                <SectionWrapper title="Forms">
                  <Forms canWrite={portalHasGlobalPermission(portalSession.value, "forms:write")} />
                </SectionWrapper>
              )}
            />
          )}
          {hasAdminCapacity && (
            <Route
              path="/groups/:groupId/events/:eventId/proposals"
              component={({ params }: { params: { groupId: string; eventId: string } }) => (
                <SectionWrapper title="Proposal Program">
                  <GroupEventProposals groupId={params.groupId} eventId={params.eventId} />
                </SectionWrapper>
              )}
            />
          )}
          {portalHasSystemManagement(portalSession.value) && (
            <Route
              path="/system/donations/detail/:donationId"
              component={({ params }: { params: { donationId: string } }) => (
                <SectionWrapper title="Donation">
                  <DonationDetailPage
                    donationId={params.donationId}
                    canRead={portalHasGlobalPermission(portalSession.value, "donations:read")}
                    canSync={portalHasGlobalPermission(portalSession.value, "donations:sync")}
                  />
                </SectionWrapper>
              )}
            />
          )}
          {portalHasSystemManagement(portalSession.value) && (
            <Route
              path="/system/:view/:resourceId"
              component={({ params }: { params: { view: string; resourceId: string } }) => (
                <SectionWrapper title="System">
                  <SystemManagement session={portalSession.value} view={params.view} resourceId={params.resourceId} />
                </SectionWrapper>
              )}
            />
          )}
          {portalHasSystemManagement(portalSession.value) && (
            <Route
              path="/system/:view?"
              component={({ params }: { params: { view?: string } }) => (
                <SectionWrapper title="System">
                  <SystemManagement session={portalSession.value} view={params.view} />
                </SectionWrapper>
              )}
            />
          )}
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
          {(hasAdminCapacity || hasMemberCapacity) && (
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
