/** Canonical destinations for admin routes that have moved to the portal. */
export const ADMIN_ACCOUNT_REDIRECT_TARGET = "/portal/#/account";

export function legacyAdminRedirectTarget(path: string): string | null {
  const pathname = path.split("?", 1)[0];
  return pathname === "/account" ? ADMIN_ACCOUNT_REDIRECT_TARGET : null;
}
