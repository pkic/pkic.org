/** Capability-derived portal shell shared by member and management identities. */
import { lazy, Suspense } from "preact/compat";
import { Router, Route, Switch } from "wouter";
import { usePortalHashLocation } from "../hash-location";
import { clearAuth, portalSession, profile } from "../state";
import type { EventWorkspaceProps } from "../sections/events/EventWorkspace";
import { Spinner } from "../../../components/Spinner";
import { PortalNavigationShell } from "./PortalNavigationShell";
import { PortalRouteFallback, PortalRouteRedirect, ScrollResetOnNavigate, SectionWrapper } from "./PortalRouteChrome";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  portalDefaultPath,
  portalHasAnyGlobalPermission,
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
const Home = lazy(() => import("../sections/Home").then((module) => ({ default: module.Home })));
const Participation = lazy(() =>
  import("../sections/Participation").then((module) => ({ default: module.Participation })),
);
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
const DonationDetailPage = lazy(() =>
  import("../sections/system-donations/DonationDetailPage").then((module) => ({ default: module.DonationDetailPage })),
);
const Donations = lazy(() =>
  import("../sections/system-donations/Donations").then((module) => ({ default: module.Donations })),
);
const Users = lazy(() => import("../sections/system-users/Users").then((module) => ({ default: module.Users })));
const Organizations = lazy(() =>
  import("../sections/system-organizations/Organizations").then((module) => ({ default: module.Organizations })),
);
const OrganizationDetail = lazy(() =>
  import("../sections/system-organizations/OrganizationDetail").then((module) => ({
    default: module.OrganizationDetail,
  })),
);
const MembershipApplications = lazy(() =>
  import("../sections/membership-applications").then((module) => ({ default: module.MembershipApplications })),
);
const RepresentedOrganizations = lazy(() =>
  import("../sections/RepresentedOrganizations").then((module) => ({ default: module.RepresentedOrganizations })),
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

export function PortalShell() {
  const session = portalSession.value;
  const hasGroupsAccess = portalSectionEnabled(session, "groups");
  const hasEventWorkspace = portalSectionEnabled(session, "events");
  const hasSponsorWorkspace = portalSectionEnabled(session, "sponsors");
  const hasFormsAccess = portalSectionEnabled(session, "forms");
  const hasMemberCapacity = portalSectionEnabled(session, "profile");
  const hasOrganizationsAccess = portalSectionEnabled(session, "organizations");
  const hasOrganizationsDirectory = portalHasAnyGlobalPermission(session, ["organizations:read", "membership:write"]);
  // Creating an organization activates its initial identities at once, so it
  // takes both permissions. Named once, because the directory route and the
  // create route have to agree on who may reach the create page.
  const canCreateOrganizations =
    portalHasGlobalPermission(session, "membership:write") && portalHasGlobalPermission(session, "identities:activate");
  const hasMembershipQueue = portalSectionEnabled(session, "membership");
  const hasUsersDirectory = portalSectionEnabled(session, "users");
  const hasDonationsAccess = portalSectionEnabled(session, "donations");
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
    <Router hook={usePortalHashLocation}>
      <ScrollResetOnNavigate />
      <PortalNavigationShell
        session={session}
        displayName={displayName}
        headshotUrl={profile.value?.headshotUrl ?? null}
      >
        <Suspense fallback={<Spinner />}>
          <Switch>
            {hasEventWorkspace && (
              <Route
                path="/events/:slug/registrations/detail/:registrationId"
                component={({ params }: { params: { slug: string; registrationId: string } }) => (
                  <LazyEventWorkspace view="registration" slug={params.slug} resourceId={params.registrationId} />
                )}
              />
            )}
            {hasEventWorkspace && (
              <Route
                path="/events/:slug/proposals/detail/:proposalId"
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
                  <SectionWrapper>
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
                  <SectionWrapper>
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
                  <SectionWrapper>
                    <Forms formKey={params.formKey} canWrite={portalHasGlobalPermission(session, "forms:write")} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasFormsAccess && (
              <Route
                path="/forms"
                component={() => (
                  <SectionWrapper>
                    <Forms canWrite={portalHasGlobalPermission(session, "forms:write")} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasOrganizationsAccess && (
              // Creation has its own address, so it survives a reload and Back
              // closes it. Must stay above `/organizations/:organizationId`:
              // wouter's <Switch> renders the first match, and the detail route
              // would otherwise open a record whose id is the word "new".
              <Route
                path="/organizations/new"
                component={() =>
                  hasOrganizationsDirectory && canCreateOrganizations ? (
                    <SectionWrapper title="Organizations">
                      <Organizations
                        canRead={portalHasGlobalPermission(session, "organizations:read")}
                        canCreate
                        organizationSegment="new"
                      />
                    </SectionWrapper>
                  ) : (
                    <PortalRouteRedirect to="/organizations" />
                  )
                }
              />
            )}
            {hasOrganizationsAccess && (
              <Route
                path="/organizations/:organizationId"
                component={({ params }: { params: { organizationId: string } }) =>
                  hasOrganizationsDirectory ? (
                    // No section title here: the record's PageHeader already
                    // carries the "Organizations" trail and the record's name,
                    // and the anatomy allows each name exactly once.
                    <SectionWrapper>
                      <OrganizationDetail
                        organizationId={params.organizationId}
                        canRead={portalHasGlobalPermission(session, "organizations:read")}
                        canWrite={portalHasGlobalPermission(session, "organizations:write")}
                        canManageIdentities={portalHasGlobalPermission(session, "membership:write")}
                        canReadSponsorships={portalHasGlobalPermission(session, "sponsorships:read")}
                      />
                    </SectionWrapper>
                  ) : (
                    // No section title: MyOrganization's own PageHeader names
                    // the record, and the anatomy allows each name exactly once.
                    <SectionWrapper>
                      <MyOrganization organizationId={params.organizationId} />
                    </SectionWrapper>
                  )
                }
              />
            )}
            {hasOrganizationsAccess && (
              <Route
                path="/organizations"
                component={() =>
                  hasOrganizationsDirectory ? (
                    <SectionWrapper title="Organizations">
                      <Organizations
                        canRead={portalHasGlobalPermission(session, "organizations:read")}
                        canCreate={canCreateOrganizations}
                      />
                    </SectionWrapper>
                  ) : (
                    <SectionWrapper>
                      <RepresentedOrganizations />
                    </SectionWrapper>
                  )
                }
              />
            )}
            {hasMembershipQueue && (
              <Route
                path="/membership/applications/:applicationId?"
                component={({ params }: { params: { applicationId?: string } }) => (
                  <SectionWrapper>
                    <MembershipApplications
                      initialApplicationId={params.applicationId}
                      canWrite={portalHasGlobalPermission(session, "membership:write")}
                      canApprove={portalHasGlobalPermission(session, "membership:approve")}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {hasUsersDirectory && (
              <Route
                path="/users/:userId?"
                component={({ params }: { params: { userId?: string } }) => (
                  <SectionWrapper>
                    <Users
                      userId={params.userId}
                      viewerUserId={session?.identity.id}
                      permissions={{
                        canRead: portalHasGlobalPermission(session, "users:read"),
                        canWrite: portalHasGlobalPermission(session, "users:write"),
                        canGrantAccess: portalHasGlobalPermission(session, "access:grant"),
                        canAnonymize: portalHasGlobalPermission(session, "users:anonymize"),
                        canManageMembership: portalHasGlobalPermission(session, "membership:write"),
                        canActivateIdentity: portalHasGlobalPermission(session, "identities:activate"),
                      }}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {hasDonationsAccess && (
              <Route
                path="/donations/detail/:donationId"
                component={({ params }: { params: { donationId: string } }) => (
                  <SectionWrapper>
                    <DonationDetailPage
                      donationId={params.donationId}
                      canRead={portalHasGlobalPermission(session, "donations:read")}
                      canSync={portalHasGlobalPermission(session, "donations:sync")}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {hasDonationsAccess && (
              <Route
                path="/donations/:subTab?"
                component={({ params }: { params: { subTab?: string } }) => (
                  <SectionWrapper>
                    <Donations
                      subTab={params.subTab}
                      canRead={portalHasGlobalPermission(session, "donations:read")}
                      canSync={portalHasGlobalPermission(session, "donations:sync")}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {hasUsersDirectory && (
              <Route
                path="/system/users/:resourceId?"
                component={({ params }: { params: { resourceId?: string } }) => (
                  <PortalRouteRedirect
                    to={params.resourceId ? `/users/${encodeURIComponent(params.resourceId)}` : "/users"}
                  />
                )}
              />
            )}
            {hasOrganizationsDirectory && (
              <Route
                path="/system/organizations/:resourceId?"
                component={({ params }: { params: { resourceId?: string } }) => (
                  <PortalRouteRedirect
                    to={
                      params.resourceId ? `/organizations/${encodeURIComponent(params.resourceId)}` : "/organizations"
                    }
                  />
                )}
              />
            )}
            {hasMembershipQueue && (
              <Route
                path="/system/membership-applications/:resourceId?"
                component={({ params }: { params: { resourceId?: string } }) => (
                  <PortalRouteRedirect
                    to={
                      params.resourceId
                        ? `/membership/applications/${encodeURIComponent(params.resourceId)}`
                        : "/membership/applications"
                    }
                  />
                )}
              />
            )}
            {hasDonationsAccess && (
              <Route
                path="/system/donations/detail/:donationId"
                component={({ params }: { params: { donationId: string } }) => (
                  <PortalRouteRedirect to={`/donations/detail/${encodeURIComponent(params.donationId)}`} />
                )}
              />
            )}
            {hasDonationsAccess && (
              <Route
                path="/system/donations/:resourceId?"
                component={({ params }: { params: { resourceId?: string } }) => (
                  <PortalRouteRedirect
                    to={params.resourceId ? `/donations/${encodeURIComponent(params.resourceId)}` : "/donations"}
                  />
                )}
              />
            )}
            {hasSystemManagement && (
              // A role detail needs a second path segment beyond the generic
              // `/system/:view/:resourceId` shape below (view="access-control",
              // resourceId="roles"), so this route composes the extra
              // `:roleId` into a single `roles/:roleId` resourceId string
              // instead of threading a third URL param through SystemManagement
              // and every other `/system/:view/:resourceId` consumer. Must stay
              // above the generic route: wouter's <Switch> renders the first
              // match, and the generic route would otherwise win with
              // resourceId="roles" and silently drop the role id.
              <Route
                path="/system/access-control/roles/:roleId"
                component={({ params }: { params: { roleId: string } }) => (
                  <SectionWrapper>
                    <SystemManagement session={session} view="access-control" resourceId={`roles/${params.roleId}`} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasSystemManagement && (
              <Route
                path="/system/:view/:resourceId"
                component={({ params }: { params: { view: string; resourceId: string } }) => (
                  <SectionWrapper>
                    <SystemManagement session={session} view={params.view} resourceId={params.resourceId} />
                  </SectionWrapper>
                )}
              />
            )}
            {hasSystemManagement && (
              <Route
                path="/system/:view?"
                component={({ params }: { params: { view?: string } }) => (
                  <SectionWrapper>
                    <SystemManagement session={session} view={params.view} />
                  </SectionWrapper>
                )}
              />
            )}
            {(hasMemberCapacity || hasAdminCapacity) && (
              <Route
                path="/home"
                component={() => (
                  <SectionWrapper>
                    <Home />
                  </SectionWrapper>
                )}
              />
            )}
            {hasGroupsAccess && (
              // Same reservation as the organizations create route: this must
              // stay above `/groups/:groupId/*?`, which would otherwise load a
              // group workspace for the id "new".
              <Route
                path="/groups/new"
                component={() => (
                  <SectionWrapper>
                    <Groups groupSegment="new" />
                  </SectionWrapper>
                )}
              />
            )}
            {hasGroupsAccess && (
              <Route
                path="/groups"
                component={() => (
                  <SectionWrapper>
                    <Groups />
                  </SectionWrapper>
                )}
              />
            )}
            {hasGroupsAccess && (
              // One route for the whole group surface: every view, resource,
              // and event sub-tab under a group renders the SAME mounted
              // GroupWorkspace, so moving between views, resources, and
              // groups only changes props — no unmount/remount blank flash,
              // no redundant refetch of the group context.
              <Route
                path="/groups/:groupId/*?"
                component={({ params }: { params: { groupId: string; "*"?: string } }) => {
                  const segments = (params["*"] ?? "").split("/").filter(Boolean).map(decodeURIComponent);
                  const [view, resourceId, resourceTab, resourceDetailId] = segments;
                  return (
                    <SectionWrapper>
                      <GroupWorkspace
                        groupId={params.groupId}
                        view={view}
                        resourceId={resourceId}
                        resourceTab={resourceTab}
                        resourceDetailId={resourceDetailId}
                      />
                    </SectionWrapper>
                  );
                }}
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
                  <SectionWrapper>
                    <MyProfile />
                  </SectionWrapper>
                )}
              />
            )}
            {hasMemberCapacity && (
              <Route
                path="/organization"
                component={() => {
                  const actingOrganizationId = profile.value?.organizationId;
                  return actingOrganizationId ? (
                    <PortalRouteRedirect to={`/organizations/${encodeURIComponent(actingOrganizationId)}`} />
                  ) : (
                    <SectionWrapper>
                      <MyOrganization />
                    </SectionWrapper>
                  );
                }}
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
                  <SectionWrapper>
                    <MyApplications />
                  </SectionWrapper>
                )}
              />
            )}
            {portalSectionEnabled(session, "participation") && (
              <Route
                path="/participation"
                component={() => (
                  <SectionWrapper>
                    <Participation />
                  </SectionWrapper>
                )}
              />
            )}
            {hasAccountAccess && (
              <Route
                path="/account"
                component={() => (
                  <SectionWrapper>
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
