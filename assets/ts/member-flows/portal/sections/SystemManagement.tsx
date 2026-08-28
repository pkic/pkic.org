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
import { SystemAnalytics } from "./system-analytics/SystemAnalytics";
import { Donations } from "./system-donations/Donations";
import { Sponsorships } from "./system-sponsorships";
import { Operations } from "./system-operations";
import { Organizations } from "./system-organizations/Organizations";
import { OrganizationDetail } from "./system-organizations/OrganizationDetail";
import { Users } from "./system-users/Users";

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
      {selected.path === "/system/analytics" ? (
        <SystemAnalytics initialTab={resourceId} />
      ) : selected.path === "/system/donations" ? (
        <Donations
          subTab={resourceId}
          canRead={portalHasGlobalPermission(session, "donations:read")}
          canSync={portalHasGlobalPermission(session, "donations:sync")}
        />
      ) : selected.path === "/system/sponsorships" ? (
        <Sponsorships
          detailId={resourceId}
          canRead={portalHasGlobalPermission(session, "sponsorships:read")}
          canWrite={portalHasGlobalPermission(session, "sponsorships:write")}
        />
      ) : selected.path === "/system/membership-applications" ? (
        <MembershipApplications
          initialApplicationId={resourceId}
          canWrite={portalHasGlobalPermission(session, "membership:write")}
          canApprove={portalHasGlobalPermission(session, "membership:approve")}
        />
      ) : selected.path === "/system/membership-settings" ? (
        <MembershipConfiguration canWrite={portalHasGlobalPermission(session, "membership:write")} />
      ) : selected.path === "/system/organization-content-reviews" ? (
        <OrganizationContentReviews />
      ) : selected.path === "/system/organizations" ? (
        resourceId ? (
          <OrganizationDetail
            organizationId={resourceId}
            canRead={portalHasGlobalPermission(session, "organizations:read")}
            canWrite={portalHasGlobalPermission(session, "organizations:write")}
            canManageRepresentatives={portalHasGlobalPermission(session, "membership:write")}
          />
        ) : (
          <Organizations
            canRead={portalHasGlobalPermission(session, "organizations:read")}
            canCreate={portalHasGlobalPermission(session, "membership:write")}
          />
        )
      ) : selected.path === "/system/users" ? (
        <Users
          userId={resourceId}
          permissions={{
            canRead: portalHasGlobalPermission(session, "users:read"),
            canWrite: portalHasGlobalPermission(session, "users:write"),
            canGrantAccess: portalHasGlobalPermission(session, "access:grant"),
            canAnonymize: portalHasGlobalPermission(session, "users:anonymize"),
            canManageMembership: portalHasGlobalPermission(session, "membership:write"),
          }}
        />
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
          canReadOperations={portalHasGlobalPermission(session, "operations:read")}
          canRunOperations={portalHasGlobalPermission(session, "operations:run")}
          canAnonymizeUsers={portalHasGlobalPermission(session, "users:anonymize")}
          canWriteMembership={portalHasGlobalPermission(session, "membership:write")}
          canApproveMembership={portalHasGlobalPermission(session, "membership:approve")}
        />
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
