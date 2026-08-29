import { useEffect } from "preact/hooks";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { EventList } from "../sections/events/EventList";
import { EventDetailView } from "../sections/events/detail/EventDetail";
import { RegistrationDetailPage } from "../sections/events/detail/RegistrationDetailPage";
import { ProposalDetailPage } from "../sections/events/detail/ProposalDetailPage";
import {
  ADMIN_ACCOUNT_REDIRECT_TARGET,
  ADMIN_ANALYTICS_REDIRECT_TARGET,
  ADMIN_ACCESS_CONTROL_REDIRECT_TARGET,
  ADMIN_AUDIT_LOG_REDIRECT_TARGET,
  ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET,
  ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET,
  ADMIN_LEADERSHIP_REDIRECT_TARGET,
  ADMIN_MAILING_LISTS_REDIRECT_TARGET,
  ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET,
  ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET,
  ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET,
  ADMIN_ORGANIZATIONS_REDIRECT_TARGET,
  ADMIN_DONATIONS_REDIRECT_TARGET,
  ADMIN_DONATION_PROMOTERS_REDIRECT_TARGET,
  ADMIN_SPONSORSHIPS_REDIRECT_TARGET,
  ADMIN_OPERATIONS_REDIRECT_TARGET,
  ADMIN_USERS_REDIRECT_TARGET,
  ADMIN_FORMS_REDIRECT_TARGET,
} from "./legacy-redirects";

function SectionWrapper({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="admin-section">
      <h4 class="section-title">{title}</h4>
      {children}
    </div>
  );
}

function PortalRedirect({ target, message }: { target: string; message: string }) {
  useEffect(() => {
    window.location.assign(target);
  }, [target]);
  return <p>{message}</p>;
}

export function AdminShell() {
  // Initialize chart tooltips once
  useEffect(() => {
    try {
      // Bootstrap tooltips
      const els = document.querySelectorAll('[data-bs-toggle="tooltip"]');
      if (els.length && (window as Record<string, any>).bootstrap?.Tooltip) {
        els.forEach((el) => new (window as Record<string, any>).bootstrap.Tooltip(el));
      }
    } catch (_) {
      // Tooltips are optional — ignore bootstrap failures
    }
  }, []);

  return (
    <Router hook={useHashLocation}>
      <div id="admin-root">
        <Topbar />
        <div id="sidebar-backdrop" />
        <Sidebar />
        <main id="admin-main">
          <Switch>
            <Route
              path="/"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ANALYTICS_REDIRECT_TARGET}
                  message="Analytics have moved to the portal."
                />
              )}
            />
            <Route
              path="/dashboard"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ANALYTICS_REDIRECT_TARGET}
                  message="Analytics have moved to the portal."
                />
              )}
            />

            <Route
              path="/events"
              component={() => (
                <SectionWrapper title="Events">
                  <EventList />
                </SectionWrapper>
              )}
            />
            <Route
              path="/events/:slug/registration/:regId"
              component={({ params }: { params: { slug: string; regId: string } }) => (
                <SectionWrapper title="Registration">
                  <RegistrationDetailPage slug={params.slug} regId={params.regId} />
                </SectionWrapper>
              )}
            />
            <Route
              path="/events/:slug/proposals/invites"
              component={() => (
                <PortalRedirect
                  target={ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET}
                  message="Speaker invitations have moved to the selected-group portal."
                />
              )}
            />
            <Route
              path="/events/:slug/registrations/invites"
              component={() => (
                <PortalRedirect
                  target={ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET}
                  message="Attendee invitations have moved to the selected-group portal."
                />
              )}
            />
            <Route
              path="/events/:slug/proposal/:proposalId"
              component={({ params }: { params: { slug: string; proposalId: string } }) => (
                <SectionWrapper title="Proposal">
                  <ProposalDetailPage slug={params.slug} proposalId={params.proposalId} />
                </SectionWrapper>
              )}
            />
            <Route
              path="/events/:slug/:tab/:subTab"
              component={({ params }: { params: { slug: string; tab: string; subTab: string } }) => (
                <SectionWrapper title="Event">
                  <EventDetailView slug={params.slug} tab={params.tab} subTab={params.subTab} />
                </SectionWrapper>
              )}
            />
            <Route
              path="/events/:slug/:tab?"
              component={({ params }: { params: { slug: string; tab?: string } }) => (
                <SectionWrapper title="Event">
                  <EventDetailView slug={params.slug} tab={params.tab} />
                </SectionWrapper>
              )}
            />

            <Route
              path="/forms/:formKey"
              component={() => (
                <PortalRedirect target={ADMIN_FORMS_REDIRECT_TARGET} message="Forms have moved to the portal." />
              )}
            />
            <Route
              path="/forms"
              component={() => (
                <PortalRedirect target={ADMIN_FORMS_REDIRECT_TARGET} message="Forms have moved to the portal." />
              )}
            />

            <Route
              path="/email"
              component={() => (
                <PortalRedirect
                  target={ADMIN_OPERATIONS_REDIRECT_TARGET}
                  message="Operations have moved to the portal."
                />
              )}
            />
            <Route
              path="/email/outbox"
              component={() => (
                <PortalRedirect
                  target={ADMIN_OPERATIONS_REDIRECT_TARGET}
                  message="Operations have moved to the portal."
                />
              )}
            />
            <Route
              path="/email/templates"
              component={() => (
                <PortalRedirect
                  target={ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET}
                  message="Email templates have moved to the portal."
                />
              )}
            />
            <Route
              path="/duework"
              component={() => (
                <PortalRedirect
                  target={ADMIN_OPERATIONS_REDIRECT_TARGET}
                  message="Operations have moved to the portal."
                />
              )}
            />
            <Route
              path="/stats/:subTab"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ANALYTICS_REDIRECT_TARGET}
                  message="Analytics have moved to the portal."
                />
              )}
            />
            <Route
              path="/stats"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ANALYTICS_REDIRECT_TARGET}
                  message="Analytics have moved to the portal."
                />
              )}
            />
            <Route
              path="/donations/detail/:id"
              component={({ params }: { params: { id: string } }) => (
                <PortalRedirect
                  target={`${ADMIN_DONATIONS_REDIRECT_TARGET}/detail/${encodeURIComponent(params.id)}`}
                  message="Donation details have moved to the portal."
                />
              )}
            />
            <Route
              path="/donations/:subTab"
              component={({ params }: { params: { subTab: string } }) => (
                <PortalRedirect
                  target={
                    params.subTab === "promoters"
                      ? ADMIN_DONATION_PROMOTERS_REDIRECT_TARGET
                      : ADMIN_DONATIONS_REDIRECT_TARGET
                  }
                  message="Donations have moved to the portal."
                />
              )}
            />
            <Route
              path="/donations"
              component={() => (
                <PortalRedirect
                  target={ADMIN_DONATIONS_REDIRECT_TARGET}
                  message="Donations have moved to the portal."
                />
              )}
            />
            <Route
              path="/users/detail/:id"
              component={({ params }: { params: { id: string } }) => (
                <PortalRedirect
                  target={`${ADMIN_USERS_REDIRECT_TARGET}/${encodeURIComponent(params.id)}`}
                  message="User management has moved to the portal."
                />
              )}
            />
            <Route
              path="/users"
              component={() => (
                <PortalRedirect
                  target={ADMIN_USERS_REDIRECT_TARGET}
                  message="User management has moved to the portal."
                />
              )}
            />
            <Route
              path="/organizations"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ORGANIZATIONS_REDIRECT_TARGET}
                  message="Organizations have moved to the portal."
                />
              )}
            />
            <Route
              path="/organizations/content-reviews"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET}
                  message="Organization content reviews have moved to the portal."
                />
              )}
            />
            <Route
              path="/sponsorships/:id"
              component={({ params }: { params: { id: string } }) => (
                <PortalRedirect
                  target={`${ADMIN_SPONSORSHIPS_REDIRECT_TARGET}/${encodeURIComponent(params.id)}`}
                  message="Sponsorship management has moved to the portal."
                />
              )}
            />
            <Route
              path="/sponsorships"
              component={() => (
                <PortalRedirect
                  target={ADMIN_SPONSORSHIPS_REDIRECT_TARGET}
                  message="Sponsorship management has moved to the portal."
                />
              )}
            />
            <Route
              path="/votes"
              component={() => (
                <PortalRedirect
                  target="/portal/#/management"
                  message="Vote management has moved to the group-centered portal."
                />
              )}
            />
            <Route
              path="/membership"
              component={() => (
                <PortalRedirect
                  target={ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET}
                  message="Membership application review has moved to the portal."
                />
              )}
            />
            <Route
              path="/membership/applications/:applicationId"
              component={({ params }: { params: { applicationId: string } }) => (
                <PortalRedirect
                  target={`${ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET}/${encodeURIComponent(params.applicationId)}`}
                  message="Membership application review has moved to the portal."
                />
              )}
            />
            <Route
              path="/membership/applications"
              component={() => (
                <PortalRedirect
                  target={ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET}
                  message="Membership application review has moved to the portal."
                />
              )}
            />
            <Route
              path="/membership/settings"
              component={() => (
                <PortalRedirect
                  target={ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET}
                  message="Membership settings have moved to the portal."
                />
              )}
            />
            <Route
              path="/access-control"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ACCESS_CONTROL_REDIRECT_TARGET}
                  message="Access Control has moved to the portal."
                />
              )}
            />
            <Route
              path="/leadership"
              component={() => (
                <PortalRedirect
                  target={ADMIN_LEADERSHIP_REDIRECT_TARGET}
                  message="Leadership management has moved to the portal."
                />
              )}
            />
            <Route
              path="/auditlog"
              component={() => (
                <PortalRedirect
                  target={ADMIN_AUDIT_LOG_REDIRECT_TARGET}
                  message="The system audit log has moved to the portal."
                />
              )}
            />
            <Route
              path="/account"
              component={() => (
                <PortalRedirect
                  target={ADMIN_ACCOUNT_REDIRECT_TARGET}
                  message="Account settings have moved to the portal."
                />
              )}
            />
            <Route
              path="/mailing-lists"
              component={() => (
                <PortalRedirect
                  target={ADMIN_MAILING_LISTS_REDIRECT_TARGET}
                  message="Mailing-list management has moved to the selected-group portal."
                />
              )}
            />

            <Route component={() => <div class="p-4 text-muted fst-italic">Section not found.</div>} />
          </Switch>
        </main>
      </div>
    </Router>
  );
}
