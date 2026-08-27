/** Canonical destinations for admin routes that have moved to the portal. */
export const ADMIN_ACCOUNT_REDIRECT_TARGET = "/portal/#/account";
export const ADMIN_AUDIT_LOG_REDIRECT_TARGET = "/portal/#/system/audit-log";
export const ADMIN_MAILING_LISTS_REDIRECT_TARGET = "/portal/#/management";
export const ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET = "/portal/#/system/membership-applications";
export const ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET = "/portal/#/system/membership-settings";
export const ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET = "/portal/#/system/organization-content-reviews";
export const ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET = "/portal/#/management";

export function legacyAdminRedirectTarget(path: string): string | null {
  const pathname = path.split("?", 1)[0];
  if (pathname === "/account") return ADMIN_ACCOUNT_REDIRECT_TARGET;
  if (pathname === "/auditlog") return ADMIN_AUDIT_LOG_REDIRECT_TARGET;
  if (pathname === "/mailing-lists") return ADMIN_MAILING_LISTS_REDIRECT_TARGET;
  if (pathname === "/membership") return ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET;
  if (pathname === "/membership/applications") return ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET;
  if (pathname.startsWith("/membership/applications/")) {
    return `${ADMIN_MEMBERSHIP_APPLICATIONS_REDIRECT_TARGET}${pathname.slice("/membership/applications".length)}`;
  }
  if (pathname === "/membership/settings") return ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET;
  if (pathname === "/organizations/content-reviews") return ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET;
  if (/^\/events\/[^/]+\/(?:proposals|registrations)\/invites$/.test(pathname)) {
    return ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET;
  }
  return null;
}
