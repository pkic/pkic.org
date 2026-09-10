/**
 * Which settings page an address opens.
 *
 * Every entry here is a page: it has its own address, it heads itself, and it
 * is listed under Settings in the sidebar. Nothing on this screen selects
 * between them — the URL does — so there is no tab strip, and no page borrows
 * another page's heading (#40).
 */
import { lazy, Suspense } from "preact/compat";

import type { PortalSession } from "../../types";
import { portalHasGlobalPermission, portalSettingsPages } from "../../shell/portal-navigation";
import { EmptyState } from "../../../../components/EmptyState";
import { Spinner } from "../../../../components/Spinner";
import { PageHeader } from "../../../../ui/PageHeader";
import { SettingsIndex } from "./SettingsIndex";

const ApplicationWorkflow = lazy(() =>
  import("../membership-settings/ApplicationWorkflow").then((module) => ({ default: module.ApplicationWorkflow })),
);
const MembershipApplicationForm = lazy(() =>
  import("../membership-settings/MembershipApplicationForm").then((module) => ({
    default: module.MembershipApplicationForm,
  })),
);
const MembershipCategories = lazy(() =>
  import("../membership-settings/MembershipCategories").then((module) => ({ default: module.MembershipCategories })),
);
const OrganizationContentReviews = lazy(() =>
  import("../OrganizationContentReviews").then((module) => ({ default: module.OrganizationContentReviews })),
);
const SystemAuditLog = lazy(() => import("../SystemAuditLog").then((module) => ({ default: module.SystemAuditLog })));
const EmailTemplates = lazy(() =>
  import("../email-templates/EmailTemplates").then((module) => ({ default: module.EmailTemplates })),
);
const EmailOutbox = lazy(() =>
  import("../system-operations/EmailOutbox").then((module) => ({ default: module.EmailOutbox })),
);
const ScheduledWork = lazy(() =>
  import("../system-operations/ScheduledWork").then((module) => ({ default: module.ScheduledWork })),
);
const ScheduledJobs = lazy(() =>
  import("../system-operations/ScheduledJobs").then((module) => ({ default: module.ScheduledJobs })),
);
const AccessControl = lazy(() => import("../access-control").then((module) => ({ default: module.AccessControl })));

export function SettingsSection({
  session,
  page,
  resourceId,
}: {
  session: PortalSession | null;
  page?: string;
  resourceId?: string;
}) {
  const pages = portalSettingsPages(session);
  if (!page) return <SettingsIndex pages={pages} />;

  const requested = `/settings/${page}`;
  if (!pages.some((candidate) => candidate.path === requested)) {
    // The reader followed a link into a page their grants do not reach. The
    // page still opens with a header — the dead end is the content, not the
    // absence of a page.
    return (
      <div class="pk pk-stack">
        <PageHeader title="Settings" />
        <EmptyState title="This settings page is not available to your account." />
      </div>
    );
  }

  return (
    <Suspense fallback={<Spinner />}>
      {requested === "/settings/application-workflow" ? (
        <ApplicationWorkflow canWrite={portalHasGlobalPermission(session, "membership:write")} />
      ) : requested === "/settings/membership-application-form" ? (
        <MembershipApplicationForm canWrite={portalHasGlobalPermission(session, "membership:write")} />
      ) : requested === "/settings/membership-categories" ? (
        <MembershipCategories canWrite={portalHasGlobalPermission(session, "membership:write")} />
      ) : requested === "/settings/organization-content-reviews" ? (
        <OrganizationContentReviews />
      ) : requested === "/settings/audit-log" ? (
        <SystemAuditLog />
      ) : requested === "/settings/email-templates" ? (
        <EmailTemplates
          canRead={portalHasGlobalPermission(session, "email-templates:read")}
          canWrite={portalHasGlobalPermission(session, "email-templates:write")}
        />
      ) : requested === "/settings/email-outbox" ? (
        <EmailOutbox canManage={portalHasGlobalPermission(session, "email:manage")} />
      ) : requested === "/settings/scheduled-work" ? (
        <ScheduledWork
          canManageEmail={portalHasGlobalPermission(session, "email:manage")}
          canRunRetention={portalHasGlobalPermission(session, "retention:run")}
          canAnonymizeUsers={portalHasGlobalPermission(session, "users:anonymize")}
          canWriteMembership={portalHasGlobalPermission(session, "membership:write")}
          canApproveMembership={portalHasGlobalPermission(session, "membership:approve")}
        />
      ) : requested === "/settings/scheduled-jobs" ? (
        <ScheduledJobs />
      ) : requested === "/settings/access-control" ? (
        <AccessControl
          canGrant={portalHasGlobalPermission(session, "access:grant")}
          canRevoke={portalHasGlobalPermission(session, "access:revoke")}
          resourceId={resourceId}
        />
      ) : null}
    </Suspense>
  );
}
