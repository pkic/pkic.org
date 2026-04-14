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
import { Users } from "../sections/Users";
import { EventList } from "../sections/events/EventList";
import { EventDetailView } from "../sections/events/detail/EventDetail";
import { RegistrationDetailPage } from "../sections/events/detail/RegistrationDetailPage";

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
    } catch (_) {}
  }, []);

  return (
    <Router hook={useHashLocation}>
      <div id="admin-root">
        <Topbar />
        <div id="sidebar-backdrop" />
        <Sidebar />
        <main id="admin-main">
          <Switch>
            <Route path="/" component={() => <SectionWrapper title="Dashboard"><Dashboard /></SectionWrapper>} />
            <Route path="/dashboard" component={() => <SectionWrapper title="Dashboard"><Dashboard /></SectionWrapper>} />

            <Route path="/events" component={() => (
              <SectionWrapper title="Events">
                <EventList />
              </SectionWrapper>
            )} />
            <Route path="/events/:slug/registration/:regId" component={({ params }: { params: { slug: string; regId: string } }) => (
              <SectionWrapper title="Registration">
                <RegistrationDetailPage slug={params.slug} regId={params.regId} />
              </SectionWrapper>
            )} />
            <Route path="/events/:slug/:tab/:subTab" component={({ params }: { params: { slug: string; tab: string; subTab: string } }) => (
              <SectionWrapper title="Event">
                <EventDetailView slug={params.slug} tab={params.tab} subTab={params.subTab} />
              </SectionWrapper>
            )} />
            <Route path="/events/:slug/:tab?" component={({ params }: { params: { slug: string; tab?: string } }) => (
              <SectionWrapper title="Event">
                <EventDetailView slug={params.slug} tab={params.tab} />
              </SectionWrapper>
            )} />

            <Route path="/email" component={() => <SectionWrapper title="Email"><Email /></SectionWrapper>} />
            <Route path="/email/templates" component={() => <SectionWrapper title="Email Templates"><Templates /></SectionWrapper>} />
            <Route path="/duework" component={() => <SectionWrapper title="Due Work"><DueWork /></SectionWrapper>} />
            <Route path="/stats/:subTab" component={({ params }: { params: { subTab: string } }) => (
              <SectionWrapper title="Stats">
                <Stats subTab={params.subTab} />
              </SectionWrapper>
            )} />
            <Route path="/stats" component={() => <SectionWrapper title="Stats"><Stats /></SectionWrapper>} />
            <Route path="/donations/:id" component={({ params }: { params: { id: string } }) => (
              <SectionWrapper title="Donation">
                <DonationDetailPage donationId={params.id} />
              </SectionWrapper>
            )} />
            <Route path="/donations/:subTab" component={({ params }: { params: { subTab: string } }) => (
              <SectionWrapper title="Donations">
                <Donations subTab={params.subTab} />
              </SectionWrapper>
            )} />
            <Route path="/donations" component={() => <SectionWrapper title="Donations"><Donations /></SectionWrapper>} />
            <Route path="/users" component={() => <SectionWrapper title="Users"><Users /></SectionWrapper>} />
            <Route path="/auditlog" component={() => <SectionWrapper title="Audit Log"><AuditLog /></SectionWrapper>} />

            <Route component={() => (
              <div class="p-4 text-muted fst-italic">Section not found.</div>
            )} />
          </Switch>
        </main>
      </div>
    </Router>
  );
}
