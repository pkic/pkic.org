import { useEffect } from "preact/hooks";
import { Router, Route, Switch } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { Topbar } from "./Topbar";
import { Sidebar } from "./Sidebar";
import { Dashboard } from "../sections/Dashboard";
import { Stats } from "../sections/Stats";
import { AuditLog } from "../sections/AuditLog";
import { Donations } from "../sections/Donations";
import { DonationDetailPage } from "../sections/DonationDetailPage";
import { Email } from "../sections/Email";
import { DueWork } from "../sections/DueWork";
import { Templates } from "../sections/Templates";
import { Users, UserDetailView } from "../sections/Users";
import { AccessControl } from "../sections/access-control";
import { WorkingGroups } from "../sections/access-control/WorkingGroups";
import { Chairs } from "../sections/access-control/Chairs";
import { AccountSettings } from "../sections/AccountSettings";
import { Organizations } from "../sections/Organizations";
import { OrganizationContentReviews } from "../sections/OrganizationContentReviews";
import { MailingLists } from "../sections/MailingLists";
import { Sponsorships } from "../sections/Sponsorships";
import { MeetingCalendar } from "../sections/MeetingCalendar";
import { Votes } from "../sections/Votes";
import { Applications } from "../sections/Applications";
import { MembershipSettings } from "../sections/MembershipSettings";
import { EventList } from "../sections/events/EventList";
import { EventDetailView } from "../sections/events/detail/EventDetail";
import { FormDetailPage, Forms } from "../sections/events/detail/Forms";
import { RegistrationDetailPage } from "../sections/events/detail/RegistrationDetailPage";
import { ProposalDetailPage } from "../sections/events/detail/ProposalDetailPage";

function SectionWrapper({ title, children }: { title: string; children: preact.ComponentChildren }) {
  return (
    <div class="admin-section">
      <h4 class="section-title">{title}</h4>
      {children}
    </div>
  );
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
                <SectionWrapper title="Dashboard">
                  <Dashboard />
                </SectionWrapper>
              )}
            />
            <Route
              path="/dashboard"
              component={() => (
                <SectionWrapper title="Dashboard">
                  <Dashboard />
                </SectionWrapper>
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
              component={({ params }: { params: { formKey: string } }) => (
                <SectionWrapper title="Form">
                  <FormDetailPage formKey={params.formKey} />
                </SectionWrapper>
              )}
            />
            <Route
              path="/forms"
              component={() => (
                <SectionWrapper title="Forms">
                  <Forms />
                </SectionWrapper>
              )}
            />

            <Route
              path="/email"
              component={() => (
                <SectionWrapper title="Email">
                  <Email />
                </SectionWrapper>
              )}
            />
            <Route
              path="/email/templates"
              component={() => (
                <SectionWrapper title="Email Templates">
                  <Templates />
                </SectionWrapper>
              )}
            />
            <Route
              path="/duework"
              component={() => (
                <SectionWrapper title="Due Work">
                  <DueWork />
                </SectionWrapper>
              )}
            />
            <Route
              path="/stats/:subTab"
              component={({ params }: { params: { subTab: string } }) => (
                <SectionWrapper title="Stats">
                  <Stats subTab={params.subTab} />
                </SectionWrapper>
              )}
            />
            <Route
              path="/stats"
              component={() => (
                <SectionWrapper title="Stats">
                  <Stats />
                </SectionWrapper>
              )}
            />
            <Route
              path="/donations/detail/:id"
              component={({ params }: { params: { id: string } }) => (
                <SectionWrapper title="Donation">
                  <DonationDetailPage donationId={params.id} />
                </SectionWrapper>
              )}
            />
            <Route
              path="/donations/:subTab"
              component={({ params }: { params: { subTab: string } }) => (
                <SectionWrapper title="Donations">
                  <Donations subTab={params.subTab} />
                </SectionWrapper>
              )}
            />
            <Route
              path="/donations"
              component={() => (
                <SectionWrapper title="Donations">
                  <Donations />
                </SectionWrapper>
              )}
            />
            <Route
              path="/users/detail/:id"
              component={({ params }: { params: { id: string } }) => {
                const [, navigate] = useHashLocation();
                return (
                  <SectionWrapper title="Users">
                    <UserDetailView userId={params.id} onBack={() => navigate("/users")} />
                  </SectionWrapper>
                );
              }}
            />
            <Route
              path="/users"
              component={() => (
                <SectionWrapper title="Users">
                  <Users />
                </SectionWrapper>
              )}
            />
            <Route
              path="/organizations"
              component={() => (
                <SectionWrapper title="Organizations">
                  <Organizations />
                </SectionWrapper>
              )}
            />
            <Route
              path="/organizations/content-reviews"
              component={() => (
                <SectionWrapper title="Organizations — Content Review">
                  <OrganizationContentReviews />
                </SectionWrapper>
              )}
            />
            <Route
              path="/mailing-lists"
              component={() => (
                <SectionWrapper title="Mailing Lists">
                  <MailingLists />
                </SectionWrapper>
              )}
            />
            <Route
              path="/sponsorships"
              component={() => (
                <SectionWrapper title="Sponsorships">
                  <Sponsorships />
                </SectionWrapper>
              )}
            />
            <Route
              path="/meeting-calendar"
              component={() => (
                <SectionWrapper title="Meeting Calendar">
                  <MeetingCalendar />
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
              path="/membership"
              component={() => (
                <SectionWrapper title="Membership — Applications">
                  <Applications />
                </SectionWrapper>
              )}
            />
            <Route
              path="/membership/applications"
              component={() => (
                <SectionWrapper title="Membership — Applications">
                  <Applications />
                </SectionWrapper>
              )}
            />
            <Route
              path="/membership/settings"
              component={() => (
                <SectionWrapper title="Membership — Settings">
                  <MembershipSettings />
                </SectionWrapper>
              )}
            />
            <Route
              path="/access-control"
              component={() => (
                <SectionWrapper title="Access Control">
                  <AccessControl />
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
              path="/chairs"
              component={() => (
                <SectionWrapper title="Chairs">
                  <Chairs />
                </SectionWrapper>
              )}
            />
            <Route
              path="/auditlog"
              component={() => (
                <SectionWrapper title="Audit Log">
                  <AuditLog />
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

            <Route component={() => <div class="p-4 text-muted fst-italic">Section not found.</div>} />
          </Switch>
        </main>
      </div>
    </Router>
  );
}
