import { describe, expect, it } from "vitest";
import {
  ADMIN_ACCOUNT_REDIRECT_TARGET,
  ADMIN_AUDIT_LOG_REDIRECT_TARGET,
  ADMIN_MAILING_LISTS_REDIRECT_TARGET,
  legacyAdminRedirectTarget,
} from "../../assets/ts/admin/shell/legacy-redirects";

describe("legacy admin route redirects", () => {
  it("moves account settings to the canonical portal route while preserving unrelated routes", () => {
    expect(legacyAdminRedirectTarget("/account")).toBe(ADMIN_ACCOUNT_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/account?from=bookmark")).toBe(ADMIN_ACCOUNT_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/users")).toBeNull();
  });

  it("moves the global audit log to permission-derived portal system management", () => {
    expect(legacyAdminRedirectTarget("/auditlog")).toBe(ADMIN_AUDIT_LOG_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/auditlog?from=bookmark")).toBe(ADMIN_AUDIT_LOG_REDIRECT_TARGET);
  });

  it("moves mailing-list management to the group-centered portal", () => {
    expect(legacyAdminRedirectTarget("/mailing-lists")).toBe(ADMIN_MAILING_LISTS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/mailing-lists?from=bookmark")).toBe(ADMIN_MAILING_LISTS_REDIRECT_TARGET);
  });
});
