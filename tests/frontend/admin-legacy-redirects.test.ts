import { describe, expect, it } from "vitest";
import {
  ADMIN_ACCOUNT_REDIRECT_TARGET,
  ADMIN_AUDIT_LOG_REDIRECT_TARGET,
  ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET,
  ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET,
  ADMIN_MAILING_LISTS_REDIRECT_TARGET,
  ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET,
  ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET,
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

  it("moves organization content moderation to system management in the portal", () => {
    expect(legacyAdminRedirectTarget("/organizations/content-reviews")).toBe(
      ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET,
    );
    expect(legacyAdminRedirectTarget("/organizations/content-reviews?from=bookmark")).toBe(
      ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET,
    );
  });

  it("moves membership settings to system management in the portal", () => {
    expect(legacyAdminRedirectTarget("/membership/settings")).toBe(ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/membership/settings?from=bookmark")).toBe(
      ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET,
    );
  });

  it("moves email templates to system management in the portal", () => {
    expect(legacyAdminRedirectTarget("/email/templates")).toBe(ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/email/templates?from=bookmark")).toBe(ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET);
  });

  it("moves event invitation bookmarks to selected-group management", () => {
    expect(legacyAdminRedirectTarget("/events/example/proposals/invites")).toBe(
      ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET,
    );
    expect(legacyAdminRedirectTarget("/events/example/registrations/invites?from=bookmark")).toBe(
      ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET,
    );
    expect(legacyAdminRedirectTarget("/events/example/proposals")).toBeNull();
  });
});
