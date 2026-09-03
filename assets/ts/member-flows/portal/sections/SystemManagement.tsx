import { lazy, Suspense } from "preact/compat";
import type { PortalSession } from "../types";
import { portalHasGlobalPermission, portalSystemNavigationItems } from "../shell/portal-navigation";
import { EmptyState } from "../../../components/EmptyState";
import { Spinner } from "../../../components/Spinner";
import { Tabs } from "../../../components/Tabs";
import { PageHeader } from "../../../ui/PageHeader";

const OrganizationContentReviews = lazy(() =>
  import("./OrganizationContentReviews").then((module) => ({ default: module.OrganizationContentReviews })),
);
const SystemAuditLog = lazy(() => import("./SystemAuditLog").then((module) => ({ default: module.SystemAuditLog })));
const MembershipConfiguration = lazy(() =>
  import("./MembershipConfiguration").then((module) => ({ default: module.MembershipConfiguration })),
);
const EmailTemplates = lazy(() =>
  import("./email-templates/EmailTemplates").then((module) => ({ default: module.EmailTemplates })),
);
const AccessControl = lazy(() => import("./access-control").then((module) => ({ default: module.AccessControl })));
const SystemAnalytics = lazy(() =>
  import("./system-analytics/SystemAnalytics").then((module) => ({ default: module.SystemAnalytics })),
);
const Operations = lazy(() => import("./system-operations").then((module) => ({ default: module.Operations })));

export function SystemManagement({
  session,
  view,
  resourceId,
}: {
  session: PortalSession | null;
  view?: string;
  resourceId?: string;
}) {
  const items = portalSystemNavigationItems(session);
  const requestedPath = view ? `/system/${view}` : null;
  const selected = requestedPath ? items.find((item) => item.path === requestedPath) : items[0];

  if (!selected) {
    // A permission-shaped dead end is still an empty state: EmptyState names
    // what is absent inside a `role="status"` region, where the bare muted
    // paragraph it replaces was announced as nothing at all. The page still
    // opens with its header — the dead end is the content, not the page.
    return (
      <div class="pk pk-stack">
        <PageHeader title="Settings" />
        <EmptyState
          title={
            items.length === 0
              ? "No system-management permissions are assigned to this account."
              : "This system-management section is not available to your account."
          }
        />
      </div>
    );
  }

  /*
   * Each section is a URL, so the strip is navigation: links marked
   * `aria-current="page"`, which is what the portal's Tabs renders when it is
   * handed `hrefFor`. The route is what selects the section — wouter's Link
   * has already navigated by the time `onChange` runs — so there is no local
   * state for it to set.
   */
  return (
    <div class="pk pk-stack">
      {/* The hub is a section root: the sidebar entry brought the reader
          here, so there is no trail, and the selected tab — not a repeated
          heading inside each tab — names the surface below the strip. */}
      <PageHeader title="Settings" />
      <Tabs
        items={items.map((item) => ({ key: item.path, label: item.label }))}
        active={selected.path}
        label="System management"
        onChange={() => undefined}
        hrefFor={(path) => path}
      />
      <Suspense fallback={<Spinner />}>
        {selected.path === "/system/analytics" ? (
          <SystemAnalytics initialTab={resourceId} />
        ) : selected.path === "/system/membership-settings" ? (
          <MembershipConfiguration canWrite={portalHasGlobalPermission(session, "membership:write")} />
        ) : selected.path === "/system/organization-content-reviews" ? (
          <OrganizationContentReviews />
        ) : selected.path === "/system/audit-log" ? (
          // The selected "Audit Log" tab already names this surface; a
          // heading restating it would say the name twice on one screen.
          <section aria-label="Audit log" class="pk-stack">
            <SystemAuditLog />
          </section>
        ) : selected.path === "/system/email-templates" ? (
          <EmailTemplates
            canRead={portalHasGlobalPermission(session, "email-templates:read")}
            canWrite={portalHasGlobalPermission(session, "email-templates:write")}
          />
        ) : selected.path === "/system/operations" ? (
          <Operations
            initialTab={resourceId}
            canReadEmail={portalHasGlobalPermission(session, "email:read")}
            canManageEmail={portalHasGlobalPermission(session, "email:manage")}
            canReadRetention={portalHasGlobalPermission(session, "retention:read")}
            canReadScheduler={portalHasGlobalPermission(session, "scheduler:read")}
            canRunRetention={portalHasGlobalPermission(session, "retention:run")}
            canAnonymizeUsers={portalHasGlobalPermission(session, "users:anonymize")}
            canWriteMembership={portalHasGlobalPermission(session, "membership:write")}
            canApproveMembership={portalHasGlobalPermission(session, "membership:approve")}
          />
        ) : selected.path === "/system/access-control" ? (
          <AccessControl
            canGrant={portalHasGlobalPermission(session, "access:grant")}
            canRevoke={portalHasGlobalPermission(session, "access:revoke")}
            resourceId={resourceId}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
