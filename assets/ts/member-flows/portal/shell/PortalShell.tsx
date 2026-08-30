/** Capability-derived portal shell shared by member and management identities. */
import { type ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect } from "preact/hooks";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { clearAuth, portalSession, profile } from "../state";
import type { EventWorkspaceProps } from "../sections/events/EventWorkspace";
import { Spinner } from "../../../components/Spinner";
import type { PortalSession } from "../types";
import { PortalNavigationShell } from "./PortalNavigationShell";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  portalCapacityFallbackPath,
  portalDefaultPath,
  portalHasGlobalPermission,
  portalSectionEnabled,
} from "./portal-navigation";

const EventWorkspace = lazy(() =>
  import("../sections/events/EventWorkspace").then((module) => ({ default: module.EventWorkspace })),
);
const MyProfile = lazy(() => import("../sections/MyProfile").then((module) => ({ default: module.MyProfile })));
const MyOrganization = lazy(() =>
  import("../sections/MyOrganization").then((module) => ({ default: module.MyOrganization })),
);
const Groups = lazy(() => import("../sections/Groups").then((module) => ({ default: module.Groups })));
const MyApplications = lazy(() =>
  import("../sections/MyApplications").then((module) => ({ default: module.MyApplications })),
);
const AccountSettings = lazy(() =>
  import("../sections/AccountSettings").then((module) => ({ default: module.AccountSettings })),
);
const Forms = lazy(() => import("../sections/Forms").then((module) => ({ default: module.Forms })));
const SystemManagement = lazy(() =>
  import("../sections/SystemManagement").then((module) => ({ default: module.SystemManagement })),
);
const GroupWorkspace = lazy(() =>
  import("../sections/management/GroupWorkspace").then((module) => ({ default: module.GroupWorkspace })),
);
const GroupEventProposals = lazy(() =>
  import("../sections/management/GroupEventProposals").then((module) => ({ default: module.GroupEventProposals })),
);
const DonationDetailPage = lazy(() =>
  import("../sections/system-donations/DonationDetailPage").then((module) => ({ default: module.DonationDetailPage })),
);
const SponsorWorkspace = lazy(() =>
  import("../sections/sponsors").then((module) => ({ default: module.SponsorWorkspace })),
);

function LazyEventWorkspace(props: EventWorkspaceProps) {
  return (
    <Suspense fallback={<Spinner />}>
      <EventWorkspace {...props} />
    </Suspense>
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
  const session = portalSession.value;
  const hasGroupsAccess = portalSectionEnabled(session, "groups");
  const hasEventWorkspace = portalSectionEnabled(session, "events");
  const hasSponsorWorkspace = portalSectionEnabled(session, "sponsors");
  const hasFormsAccess = portalSectionEnabled(session, "forms");
  const hasMemberCapacity = portalSectionEnabled(session, "profile");
  const hasSystemManagement = portalSectionEnabled(session, "system");
  const hasAccountAccess = portalSectionEnabled(session, "account");
  const hasAdminCapacity = Boolean(session?.staff);
  const defaultPath = portalDefaultPath(session);
  const displayName =
    profile.value?.preferredName ||
    [profile.value?.firstName, profile.value?.lastName].filter(Boolean).join(" ").trim() ||
    profile.value?.email ||
    session?.identity.email ||
    "";
  return (
    <Router hook={useHashLocation}>
      <PortalNavigationShell
        session={session}
        displayName={displayName}
        headshotUrl={profile.value?.headshotUrl ?? null}
      >
        <Suspense fallback={<Spinner />}>
          <Switch>
            {hasEventWorkspace && (
              <Route
                path="/events/:slug/registrations/:registrationId"
                component={({ params }: { params: { slug: string; registrationId: string } }) => (
                  <LazyEventWorkspace view="registration" slug={params.slug} resourceId={params.registrationId} />
                )}
              />
            )}
            {hasEventWorkspace && (
              <Route
                path="/events/:slug/proposals/:proposalId"
                component={({ params }: { params: { slug: string; proposalId: string } }) => (
                  <LazyEventWorkspace view="proposal" slug={params.slug} resourceId={params.proposalId} />
                )}
              />
            )}
            {hasEventWorkspace && (
              <Route
                path="/events/:slug/:tab/:subTab"
                component={({ params }: { params: { slug: string; tab: string; subTab: string } }) => (
                  <LazyEventWorkspace view="detail" slug={params.slug} tab={params.tab} subTab={params.subTab} />
                )}
              />
            )}
            {hasEventWorkspace && (
              <Route
                path="/events/:slug/:tab?"
                component={({ params }: { params: { slug: string; tab?: string } }) => (
                  <LazyEventWorkspace view="detail" slug={params.slug} tab={params.tab} />
                )}
              />
            )}
            {hasEventWorkspace && <Route path="/events" component={() => <LazyEventWorkspace view="list" />} />}
            {hasSponsorWorkspace && (
              <Route path="/sponsors/access" component={() => <PortalRouteRedirect to="/sponsors" />} />
            )}
            {hasSponsorWorkspace && (
              <Route
                path="/sponsors/:sponsorId"
                component={({ params }: { params: { sponsorId: string } }) => (
                  <SectionWrapper title="Sponsors">
                    <SponsorWorkspace
                      sponsors={session?.sponsors ?? []}
                      canRead={portalHasGlobalPermission(session, "sponsorships:read")}
                      canWrite={portalHasGlobalPermission(session, "sponsorships:write")}
                      detailId={params.sponsorId}
                      onSessionExpired={clearAuth}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {hasSponsorWorkspace && (
              <Route
                path="/sponsors"
                component={() => (
                  <SectionWrapper title="Sponsors">
                    <SponsorWorkspace
                      sponsors={session?.sponsors ?? []}
                      canRead={portalHasGlobalPermission(session, "sponsorships:read")}
                      canWrite={portalHasGlobalPermission(session, "sponsorships:write")}
                      onSessionExpired={clearAuth}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {hasFormsAccess && (
              <Route
                path="/forms/:formKey"
                component={({ params }: { params: { formKey: string } }) => (
                  <SectionWrapper title="Forms">
                    <Forms formKey={params.formKey} canWrite={portalHasGlobalPermission(session, "forms:write")} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasFormsAccess && (
              <Route
                path="/forms"
                component={() => (
                  <SectionWrapper title="Forms">
                    <Forms canWrite={portalHasGlobalPermission(session, "forms:write")} />
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
            {hasSystemManagement && (
              <Route
                path="/system/donations/detail/:donationId"
                component={({ params }: { params: { donationId: string } }) => (
                  <SectionWrapper title="Donation">
                    <DonationDetailPage
                      donationId={params.donationId}
                      canRead={portalHasGlobalPermission(session, "donations:read")}
                      canSync={portalHasGlobalPermission(session, "donations:sync")}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {hasSystemManagement && (
              <Route
                path="/system/:view/:resourceId"
                component={({ params }: { params: { view: string; resourceId: string } }) => (
                  <SectionWrapper title="Administration">
                    <SystemManagement session={session} view={params.view} resourceId={params.resourceId} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasSystemManagement && (
              <Route
                path="/system/:view?"
                component={({ params }: { params: { view?: string } }) => (
                  <SectionWrapper title="Administration">
                    <SystemManagement session={session} view={params.view} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasGroupsAccess && (
              <Route
                path="/groups"
                component={() => (
                  <SectionWrapper title="Groups">
                    <Groups />
                  </SectionWrapper>
                )}
              />
            )}
            {hasGroupsAccess && (
              <Route
                path="/groups/:groupId/:view/:resourceId"
                component={({ params }: { params: { groupId: string; view: string; resourceId: string } }) => (
                  <SectionWrapper title="Group">
                    <GroupWorkspace groupId={params.groupId} view={params.view} resourceId={params.resourceId} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasGroupsAccess && (
              <Route
                path="/groups/:groupId/:view?"
                component={({ params }: { params: { groupId: string; view?: string } }) => (
                  <SectionWrapper title="Group">
                    <GroupWorkspace groupId={params.groupId} view={params.view} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasGroupsAccess && (
              <Route
                path="/management/:groupId/:view?"
                component={({ params }: { params: { groupId: string; view?: string } }) => (
                  <PortalRouteRedirect
                    to={`/groups/${encodeURIComponent(params.groupId)}/${encodeURIComponent(params.view ?? "overview")}`}
                  />
                )}
              />
            )}
            {hasGroupsAccess && <Route path="/management" component={() => <PortalRouteRedirect to="/groups" />} />}
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
            {hasGroupsAccess &&
              Object.entries(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS).map(([from, to]) => (
                <Route key={from} path={from} component={() => <PortalRouteRedirect to={to} />} />
              ))}
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
            {hasAccountAccess && (
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
            <Route component={() => <PortalRouteFallback session={session} />} />
          </Switch>
        </Suspense>
      </PortalNavigationShell>
    </Router>
  );
}
