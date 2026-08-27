/** Canonical destinations for admin routes that have moved to the portal. */
export const ADMIN_ACCOUNT_REDIRECT_TARGET = "/portal/#/account";
export const ADMIN_MAILING_LISTS_REDIRECT_TARGET = "/portal/#/management";

export function legacyAdminRedirectTarget(path: string): string | null {
  const pathname = path.split("?", 1)[0];
  if (pathname === "/account") return ADMIN_ACCOUNT_REDIRECT_TARGET;
  if (pathname === "/mailing-lists") return ADMIN_MAILING_LISTS_REDIRECT_TARGET;
  return null;
}
