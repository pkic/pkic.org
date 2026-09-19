import { portalEventParticipantRoutes } from "./portal-event-participant-routes";
/** Capability-derived portal shell shared by member and management identities. */
import type { ComponentChildren } from "preact";
import { Suspense } from "preact/compat";
import { Router, Route, Switch } from "wouter";
import { portalAnalyticsRoutes } from "./portal-analytics-routes";
import { usePortalHashLocation } from "../hash-location";
import { LazyEventWorkspace } from "./LazyEventWorkspace";
import {
  AccountSettings,
  DonationAnalytics,
  DonationDetailPage,
  Donations,
  EventAnalytics,
  Forms,
  GroupWorkspace,
  Groups,
  Home,
  Members,
  MembershipApplications,
  WorkflowReviewPage,
  MyApplications,
  MyOrganization,
  OrganizationDetail,
  Organizations,
  Participation,
  RepresentedOrganizations,
  SettingsSection,
  SponsorWorkspace,
  Users,
} from "./portal-sections";
import { clearAuth, portalSession, profile, signedInWithLink } from "../state";
import { Spinner } from "../../../components/Spinner";
import { PortalNavigationShell } from "./PortalNavigationShell";
import { PortalRouteFallback, PortalRouteRedirect, ScrollResetOnNavigate, SectionWrapper } from "./PortalRouteChrome";
import { useAutomaticPasskeyUpgrade } from "../../../components/passkey-enrollment";
import {
  PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS,
  PORTAL_SUPERSEDED_SETTINGS_ROUTES,
  portalDefaultPath,
  portalHasGlobalPermission,
} from "./portal-navigation";
import { derivePortalAccess } from "./portal-access";

export function PortalShell() {
  const session = portalSession.value;
  /*
   * A sign-in that used an emailed link is one the platform may be willing to
   * upgrade to a passkey by itself. Gated on the same capacity that owns
   * passkeys in account settings: an identity that may not manage them must
   * not have one made for it.
   */
  useAutomaticPasskeyUpgrade(signedInWithLink.value && Boolean(session?.member || session?.staff));
  const access = derivePortalAccess(session);
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
            {/* Each domain's analytics page, every one of them a reserved
                segment that has to match before its section's own `:id` route.
                See `portal-analytics-routes.tsx` (#39). */}
            {portalAnalyticsRoutes(access, (children: ComponentChildren) => (
              <SectionWrapper>{children}</SectionWrapper>
            ))}
            {/*
              A reserved segment, and it has to be routed above `/events/:slug`
              or the workspace claims it as the slug of an event called
              "analytics". Analytics live under the domain they measure rather
              than in one system-wide panel inside Settings (#39).
            */}
            {access.hasEventWorkspace && access.canReadAnalytics && (
              <Route
                path="/events/analytics/:tab?"
                component={({ params }: { params: { tab?: string } }) => (
                  <SectionWrapper>
                    <EventAnalytics initialTab={params.tab} />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasEventWorkspace && (
              <Route
                path="/events/:slug/registrations/detail/:registrationId"
                component={({ params }: { params: { slug: string; registrationId: string } }) => (
                  <LazyEventWorkspace view="registration" slug={params.slug} resourceId={params.registrationId} />
                )}
              />
            )}
            {access.hasEventWorkspace && (
              <Route
                path="/events/:slug/proposals/detail/:proposalId/:tab?/:segment?"
                component={({
                  params,
                }: {
                  params: { slug: string; proposalId: string; tab?: string; segment?: string };
                }) => (
                  <LazyEventWorkspace
                    view="proposal"
                    slug={params.slug}
                    resourceId={params.proposalId}
                    tab={params.tab}
                    segment={params.segment}
                  />
                )}
              />
            )}
            {access.hasEventWorkspace && portalEventParticipantRoutes()}
            {access.hasEventWorkspace && (
              // A team member is added on a page below the Team tab, which is
              // one segment deeper than the generic route reaches — the same
              // shape the registration and proposal detail routes above use.
              <Route
                path="/events/:slug/settings/team/:teamSegment"
                component={({ params }: { params: { slug: string; teamSegment: string } }) => (
                  <LazyEventWorkspace
                    view="detail"
                    slug={params.slug}
                    tab="settings"
                    subTab="team"
                    detailSegment={params.teamSegment}
                  />
                )}
              />
            )}
            {access.hasEventWorkspace && (
              <Route
                path="/events/:slug/:tab/:subTab"
                component={({ params }: { params: { slug: string; tab: string; subTab: string } }) => (
                  <LazyEventWorkspace view="detail" slug={params.slug} tab={params.tab} subTab={params.subTab} />
                )}
              />
            )}
            {access.hasEventWorkspace && (
              <Route
                path="/events/:slug/:tab?"
                component={({ params }: { params: { slug: string; tab?: string } }) => (
                  <LazyEventWorkspace view="detail" slug={params.slug} tab={params.tab} />
                )}
              />
            )}
            {access.hasEventWorkspace && <Route path="/events" component={() => <LazyEventWorkspace view="list" />} />}
            {access.hasSponsorWorkspace && (
              <Route path="/sponsors/access" component={() => <PortalRouteRedirect to="/sponsors" />} />
            )}
            {access.hasSponsorWorkspace && (
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
            {access.hasSponsorWorkspace && (
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
            {access.hasFormsAccess && (
              <Route
                path="/forms/:formKey"
                component={({ params }: { params: { formKey: string } }) => (
                  <SectionWrapper>
                    <Forms formKey={params.formKey} canWrite={portalHasGlobalPermission(session, "forms:write")} />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasFormsAccess && (
              <Route
                path="/forms"
                component={() => (
                  <SectionWrapper>
                    <Forms canWrite={portalHasGlobalPermission(session, "forms:write")} />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasOrganizationsAccess && (
              // Creation has its own address, so it survives a reload and Back
              // closes it. Must stay above `/organizations/:organizationId`:
              // wouter's <Switch> renders the first match, and the detail route
              // would otherwise open a record whose id is the word "new".
              <Route
                path="/organizations/new"
                component={() =>
                  access.hasOrganizationsDirectory && access.canCreateOrganizations ? (
                    <SectionWrapper>
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
            {access.hasOrganizationsAccess && (
              // Adding a representative has its own address, so it survives a
              // reload and Back closes it. Must stay above
              // `/organizations/:organizationId`, which would otherwise win.
              // The staff record manages representatives from its own roster,
              // so a directory reader is sent back to it.
              <Route
                path="/organizations/:organizationId/representatives/:representativeSegment"
                component={({ params }: { params: { organizationId: string; representativeSegment: string } }) =>
                  access.hasOrganizationsDirectory ? (
                    <PortalRouteRedirect to={`/organizations/${encodeURIComponent(params.organizationId)}`} />
                  ) : (
                    <SectionWrapper>
                      <MyOrganization
                        organizationId={params.organizationId}
                        representativeSegment={params.representativeSegment}
                      />
                    </SectionWrapper>
                  )
                }
              />
            )}
            {access.hasOrganizationsAccess && (
              <Route
                path="/organizations/:organizationId"
                component={({ params }: { params: { organizationId: string } }) =>
                  access.hasOrganizationsDirectory ? (
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
            {access.hasOrganizationsAccess && (
              <Route
                path="/organizations"
                component={() =>
                  access.hasOrganizationsDirectory ? (
                    <SectionWrapper>
                      <Organizations
                        canRead={portalHasGlobalPermission(session, "organizations:read")}
                        canCreate={access.canCreateOrganizations}
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
            {access.hasMembersRoll && (
              // One route with an optional segment, as `/users/:userId?` is:
              // the grant has its own address, so it survives a reload and
              // Back closes it.
              <Route
                path="/members/:memberSegment?"
                component={({ params }: { params: { memberSegment?: string } }) => (
                  <SectionWrapper>
                    <Members
                      canGrant={access.canGrantMembership}
                      canWrite={portalHasGlobalPermission(session, "membership:write")}
                      memberSegment={params.memberSegment}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            <Route
              path="/membership/applications/:applicationId/review"
              component={({ params }: { params: { applicationId: string } }) => (
                <SectionWrapper>
                  <WorkflowReviewPage applicationId={params.applicationId} />
                </SectionWrapper>
              )}
            />
            {access.hasMembershipQueue && (
              <Route
                path="/membership/applications/:applicationId?/:tab?"
                component={({ params }: { params: { applicationId?: string; tab?: string } }) => (
                  <SectionWrapper>
                    <MembershipApplications
                      initialApplicationId={params.applicationId}
                      initialTab={params.tab}
                      canWrite={portalHasGlobalPermission(session, "membership:write")}
                      canApprove={portalHasGlobalPermission(session, "membership:approve")}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasUserRecords && (
              <Route
                path="/users/:userId?/:section?/:segment?"
                component={({ params }: { params: { userId?: string; section?: string; segment?: string } }) => (
                  <SectionWrapper>
                    <Users
                      userId={params.userId}
                      section={params.section}
                      segment={params.segment}
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
            {access.hasDonationsAccess && (
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
            {/*
              A sub page, so it is a page: routed above the section's own tab
              route, or "analytics" would be read as the name of a tab (#43).
            */}
            {access.hasDonationsAccess && access.canReadAnalytics && (
              <Route
                path="/donations/analytics"
                component={() => (
                  <SectionWrapper>
                    <DonationAnalytics />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasDonationsAccess && (
              <Route
                // The section's pages — the list, the share links, and the
                // analytics with its own views — are addresses under one
                // lazily loaded module rather than a chunk each.
                path="/donations/:pageSegment?/:view?"
                component={({ params }: { params: { pageSegment?: string; view?: string } }) => (
                  <SectionWrapper>
                    <Donations
                      pageSegment={params.pageSegment}
                      view={params.view}
                      canRead={portalHasGlobalPermission(session, "donations:read")}
                      canSync={portalHasGlobalPermission(session, "donations:sync")}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {/* Addresses the Settings shell used to own; the table says where
                each domain took them, so the shell only mounts them. */}
            {PORTAL_SUPERSEDED_SETTINGS_ROUTES.filter((route) => route.access(session)).map((route) => (
              <Route
                key={route.from}
                path={route.from}
                component={({ params }: { params: { resourceId?: string } }) => (
                  <PortalRouteRedirect to={route.to(params.resourceId)} />
                )}
              />
            ))}
            {access.hasSettingsAccess && (
              // An access-control sub-view — a role's detail, the grant create
              // page — needs a second segment beyond the generic
              // `/settings/:page/:resourceId` shape below, so this route composes
              // it into one `:tab/:detailId` resourceId rather than threading a
              // third URL param through every consumer. Must stay above the
              // generic route, which would otherwise win and drop the id.
              <Route
                path="/settings/access-control/:tab/:detailId"
                component={({ params }: { params: { tab: string; detailId: string } }) => (
                  <SectionWrapper>
                    <SettingsSection
                      session={session}
                      page="access-control"
                      resourceId={`${params.tab}/${params.detailId}`}
                    />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasSettingsAccess && (
              <Route
                path="/settings/:page/:resourceId"
                component={({ params }: { params: { page: string; resourceId: string } }) => (
                  <SectionWrapper>
                    <SettingsSection session={session} page={params.page} resourceId={params.resourceId} />
                  </SectionWrapper>
                )}
              />
            )}
            {/* Each segment is a settings page, not a tab on one: the section
                has no tabbed surface for a page name to be mistaken for. */}
            {access.hasSettingsAccess && (
              <Route
                path="/settings/:page?"
                component={({ params }: { params: { page?: string } }) => (
                  <SectionWrapper>
                    <SettingsSection session={session} page={params.page} />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasHomeAccess && (
              <Route
                path="/home"
                component={() => (
                  <SectionWrapper>
                    <Home />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasGroupsAccess && (
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
            {access.hasGroupsAccess && (
              <Route
                path="/groups"
                component={() => (
                  <SectionWrapper>
                    <Groups />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasGroupsAccess && (
              // One route for the whole group surface: every view, resource,
              // and event sub-tab under a group renders the SAME mounted
              // GroupWorkspace, so moving between views, resources, and
              // groups only changes props — no unmount/remount blank flash,
              // no redundant refetch of the group context.
              <Route
                path="/groups/:groupId/*?"
                component={({ params }: { params: { groupId: string; "*"?: string } }) => {
                  const segments = (params["*"] ?? "").split("/").filter(Boolean).map(decodeURIComponent);
                  const [view, resourceId, resourceTab, resourceDetailId, resourceDetailTab, resourceDetailSegment] =
                    segments;
                  return (
                    <SectionWrapper>
                      <GroupWorkspace
                        groupId={params.groupId}
                        view={view}
                        resourceId={resourceId}
                        resourceTab={resourceTab}
                        resourceDetailId={resourceDetailId}
                        resourceDetailTab={resourceDetailTab}
                        resourceDetailSegment={resourceDetailSegment}
                      />
                    </SectionWrapper>
                  );
                }}
              />
            )}
            {access.hasGroupsAccess && (
              <Route
                path="/management/:groupId/:view?"
                component={({ params }: { params: { groupId: string; view?: string } }) => (
                  <PortalRouteRedirect
                    to={`/groups/${encodeURIComponent(params.groupId)}/${encodeURIComponent(params.view ?? "overview")}`}
                  />
                )}
              />
            )}
            {access.hasGroupsAccess && (
              <Route path="/management" component={() => <PortalRouteRedirect to="/groups" />} />
            )}
            {access.hasMemberOrganization && (
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
            {access.hasGroupsAccess &&
              Object.entries(PORTAL_LEGACY_MEMBER_ROUTE_REDIRECTS).map(([from, to]) => (
                <Route key={from} path={from} component={() => <PortalRouteRedirect to={to} />} />
              ))}
            {access.hasMemberApplication && (
              <Route
                path="/application"
                component={() => (
                  <SectionWrapper>
                    <MyApplications />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasParticipationRecord && (
              <Route
                path="/participation"
                component={() => (
                  <SectionWrapper>
                    <Participation />
                  </SectionWrapper>
                )}
              />
            )}
            {access.hasAccountAccess && (
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
