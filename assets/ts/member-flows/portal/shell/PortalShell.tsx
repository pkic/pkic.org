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
  portalHasPermissionAtAnyScope,
  portalHasSponsorWorkspace,
  portalHasSystemManagement,
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
const Management = lazy(() =>
  import("../sections/management/Management").then((module) => ({ default: module.Management })),
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
  const hasMemberCapacity = Boolean(portalSession.value?.member);
  const hasAdminCapacity = Boolean(portalSession.value?.staff);
  const defaultPath = portalDefaultPath(portalSession.value);
  const hasEventWorkspace = portalHasPermissionAtAnyScope(portalSession.value, "events:read");
  const displayName =
    profile.value?.preferredName ||
    [profile.value?.firstName, profile.value?.lastName].filter(Boolean).join(" ").trim() ||
    profile.value?.email ||
    portalSession.value?.identity.email ||
    "";
  return (
    <Router hook={useHashLocation}>
      <PortalNavigationShell session={portalSession.value} displayName={displayName}>
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
            {portalHasSponsorWorkspace(portalSession.value) && (
              <Route path="/sponsors/access" component={() => <PortalRouteRedirect to="/sponsors" />} />
            )}
            {portalHasSponsorWorkspace(portalSession.value) && (
              <Route
                path="/sponsors/:sponsorId"
                component={({ params }: { params: { sponsorId: string } }) => (
                  <SectionWrapper title="Sponsors">
                    <SponsorWorkspace
                      sponsors={portalSession.value?.sponsors ?? []}
                      canRead={portalHasGlobalPermission(portalSession.value, "sponsorships:read")}
                      canWrite={portalHasGlobalPermission(portalSession.value, "sponsorships:write")}
                      detailId={params.sponsorId}
                      onSessionExpired={clearAuth}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {portalHasSponsorWorkspace(portalSession.value) && (
              <Route
                path="/sponsors"
                component={() => (
                  <SectionWrapper title="Sponsors">
                    <SponsorWorkspace
                      sponsors={portalSession.value?.sponsors ?? []}
                      canRead={portalHasGlobalPermission(portalSession.value, "sponsorships:read")}
                      canWrite={portalHasGlobalPermission(portalSession.value, "sponsorships:write")}
                      onSessionExpired={clearAuth}
                    />
                  </SectionWrapper>
                )}
              />
            )}
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
            {(hasAdminCapacity || hasMemberCapacity) && (
              <Route
                path="/groups/:groupId/votes/:voteId"
                component={({ params }: { params: { groupId: string; voteId: string } }) => (
                  <SectionWrapper title="Group">
                    <Management groupId={params.groupId} view="votes" resourceId={params.voteId} />
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
        </Suspense>
      </PortalNavigationShell>
    </Router>
  );
}
