import { lazy, Suspense } from "preact/compat";
import { Link } from "wouter";
import type { PortalSession } from "../types";
import { portalHasGlobalPermission, portalSystemNavigationItems } from "../shell/portal-navigation";
import { Spinner } from "../../../components/Spinner";

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
const Leadership = lazy(() => import("./leadership/Leadership").then((module) => ({ default: module.Leadership })));
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
    return (
      <p class="text-muted">
        {items.length === 0
          ? "No system-management permissions are assigned to this account."
          : "This system-management section is not available to your account."}
      </p>
    );
  }

  return (
    <div>
      <nav class="nav nav-tabs mb-3" aria-label="System management">
        {items.map((item) => (
          <Link
            key={item.path}
            href={item.path}
            class={`nav-link${selected.path === item.path ? " active" : ""}`}
            aria-current={selected.path === item.path ? "page" : undefined}
          >
            {item.label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<Spinner />}>
        {selected.path === "/system/analytics" ? (
          <SystemAnalytics initialTab={resourceId} />
        ) : selected.path === "/system/membership-settings" ? (
          <MembershipConfiguration canWrite={portalHasGlobalPermission(session, "membership:write")} />
        ) : selected.path === "/system/organization-content-reviews" ? (
          <OrganizationContentReviews />
        ) : selected.path === "/system/audit-log" ? (
          <section aria-labelledby="system-audit-log-heading">
            <h5 id="system-audit-log-heading" class="mb-3">
              System Audit Log
            </h5>
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
        ) : selected.path === "/system/leadership" ? (
          <Leadership
            canGrant={portalHasGlobalPermission(session, "access:grant")}
            canRevoke={portalHasGlobalPermission(session, "access:revoke")}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
