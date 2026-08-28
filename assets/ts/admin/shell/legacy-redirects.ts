/** Canonical destinations for admin routes that have moved to the portal. */
export const ADMIN_ACCOUNT_REDIRECT_TARGET = "/portal/#/account";
export const ADMIN_ACCESS_CONTROL_REDIRECT_TARGET = "/portal/#/system/access-control";
export const ADMIN_AUDIT_LOG_REDIRECT_TARGET = "/portal/#/system/audit-log";
export const ADMIN_MAILING_LISTS_REDIRECT_TARGET = "/portal/#/management";
export const ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET = "/portal/#/system/membership-applications";
export const ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET = "/portal/#/system/membership-settings";
export const ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET = "/portal/#/system/organization-content-reviews";
export const ADMIN_ORGANIZATIONS_REDIRECT_TARGET = "/portal/#/system/organizations";
export const ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET = "/portal/#/management";
export const ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET = "/portal/#/system/email-templates";
export const ADMIN_LEADERSHIP_REDIRECT_TARGET = "/portal/#/system/leadership";
export const ADMIN_ANALYTICS_REDIRECT_TARGET = "/portal/#/system/analytics";
export const ADMIN_DONATIONS_REDIRECT_TARGET = "/portal/#/system/donations";
export const ADMIN_DONATION_PROMOTERS_REDIRECT_TARGET = "/portal/#/system/donations/promoters";
export const ADMIN_SPONSORSHIPS_REDIRECT_TARGET = "/portal/#/system/sponsorships";
export const ADMIN_OPERATIONS_REDIRECT_TARGET = "/portal/#/system/operations";
export const ADMIN_USERS_REDIRECT_TARGET = "/portal/#/system/users";

export function legacyAdminRedirectTarget(path: string): string | null {
  const pathname = path.split("?", 1)[0];
  if (pathname === "/" || pathname === "/dashboard") return ADMIN_ANALYTICS_REDIRECT_TARGET;
  if (pathname === "/stats" || pathname.startsWith("/stats/")) return ADMIN_ANALYTICS_REDIRECT_TARGET;
  if (pathname === "/account") return ADMIN_ACCOUNT_REDIRECT_TARGET;
  if (pathname === "/access-control") return ADMIN_ACCESS_CONTROL_REDIRECT_TARGET;
  if (pathname === "/auditlog") return ADMIN_AUDIT_LOG_REDIRECT_TARGET;
  if (pathname === "/mailing-lists") return ADMIN_MAILING_LISTS_REDIRECT_TARGET;
  if (pathname === "/membership") return ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET;
  if (pathname === "/membership/applications") return ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET;
  if (pathname.startsWith("/membership/applications/")) {
    return `${ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET}${pathname.slice("/membership/applications".length)}`;
  }
  if (pathname === "/membership/settings") return ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET;
  if (pathname === "/email/templates") return ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET;
  if (pathname === "/email" || pathname === "/email/outbox") return ADMIN_OPERATIONS_REDIRECT_TARGET;
  if (pathname === "/duework") return ADMIN_OPERATIONS_REDIRECT_TARGET;
  if (pathname === "/donations") return ADMIN_DONATIONS_REDIRECT_TARGET;
  if (pathname === "/donations/promoters") return ADMIN_DONATION_PROMOTERS_REDIRECT_TARGET;
  if (pathname === "/sponsorships") return ADMIN_SPONSORSHIPS_REDIRECT_TARGET;
  if (pathname.startsWith("/sponsorships/")) {
    return `${ADMIN_SPONSORSHIPS_REDIRECT_TARGET}/${encodeURIComponent(pathname.slice("/sponsorships/".length))}`;
  }
  if (pathname.startsWith("/donations/detail/")) {
    return `${ADMIN_DONATIONS_REDIRECT_TARGET}/detail/${encodeURIComponent(pathname.slice("/donations/detail/".length))}`;
  }
  if (pathname === "/leadership") return ADMIN_LEADERSHIP_REDIRECT_TARGET;
  if (pathname === "/organizations/content-reviews") return ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET;
  if (pathname === "/organizations") return ADMIN_ORGANIZATIONS_REDIRECT_TARGET;
  if (pathname === "/users") return ADMIN_USERS_REDIRECT_TARGET;
  if (pathname.startsWith("/users/detail/")) {
    return `${ADMIN_USERS_REDIRECT_TARGET}/${encodeURIComponent(pathname.slice("/users/detail/".length))}`;
  }
  if (/^\/events\/[^/]+\/(?:proposals|registrations)\/invites$/.test(pathname)) {
    return ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET;
  }
  return null;
}
