import { Link } from "wouter";
import type { PortalSession } from "../types";
import { portalHasGlobalPermission, portalSystemNavigationItems } from "../shell/portal-navigation";
import { OrganizationContentReviews } from "./OrganizationContentReviews";
import { SystemAuditLog } from "./SystemAuditLog";
import { MembershipApplications } from "./membership-applications";
import { MembershipConfiguration } from "./MembershipConfiguration";
import { EmailTemplates } from "./email-templates/EmailTemplates";
import { AccessControl } from "./access-control";
import { Leadership } from "./leadership/Leadership";

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
      {selected.path === "/system/membership-applications" ? (
        <MembershipApplications
          initialApplicationId={resourceId}
          canWrite={portalHasGlobalPermission(session, "membership:write")}
          canApprove={portalHasGlobalPermission(session, "membership:approve")}
        />
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
        <EmailTemplates canWrite={portalHasGlobalPermission(session, "email-templates:write")} />
      ) : selected.path === "/system/access-control" ? (
        <AccessControl
          canGrant={portalHasGlobalPermission(session, "access:grant")}
          canRevoke={portalHasGlobalPermission(session, "access:revoke")}
        />
      ) : selected.path === "/system/leadership" ? (
        <Leadership
          canGrant={portalHasGlobalPermission(session, "access:grant")}
          canRevoke={portalHasGlobalPermission(session, "access:revoke")}
        />
      ) : null}
    </div>
  );
}
