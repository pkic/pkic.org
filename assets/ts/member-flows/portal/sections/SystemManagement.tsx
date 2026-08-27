import { Link } from "wouter";
import type { PortalSession } from "../types";
import { portalSystemNavigationItems } from "../shell/portal-navigation";
import { OrganizationContentReviews } from "./OrganizationContentReviews";
import { SystemAuditLog } from "./SystemAuditLog";

export function SystemManagement({ session, view }: { session: PortalSession | null; view?: string }) {
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
      {selected.path === "/system/organization-content-reviews" ? (
        <OrganizationContentReviews />
      ) : selected.path === "/system/audit-log" ? (
        <SystemAuditLog />
      ) : null}
    </div>
  );
}
