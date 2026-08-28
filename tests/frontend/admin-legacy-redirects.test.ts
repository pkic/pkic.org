import { describe, expect, it } from "vitest";
import {
  ADMIN_ACCESS_CONTROL_REDIRECT_TARGET,
  ADMIN_ANALYTICS_REDIRECT_TARGET,
  ADMIN_ACCOUNT_REDIRECT_TARGET,
  ADMIN_DONATION_PROMOTERS_REDIRECT_TARGET,
  ADMIN_DONATIONS_REDIRECT_TARGET,
  ADMIN_AUDIT_LOG_REDIRECT_TARGET,
  ADMIN_EMAIL_TEMPLATES_REDIRECT_TARGET,
  ADMIN_EVENT_INVITATIONS_REDIRECT_TARGET,
  ADMIN_LEADERSHIP_REDIRECT_TARGET,
  ADMIN_MAILING_LISTS_REDIRECT_TARGET,
  ADMIN_MEMBERSHIP_SETTINGS_REDIRECT_TARGET,
  ADMIN_ORGANIZATION_CONTENT_REVIEWS_REDIRECT_TARGET,
  ADMIN_ORGANIZATIONS_REDIRECT_TARGET,
  ADMIN_SPONSORSHIPS_REDIRECT_TARGET,
  ADMIN_OPERATIONS_REDIRECT_TARGET,
  ADMIN_USERS_REDIRECT_TARGET,
  legacyAdminRedirectTarget,
} from "../../assets/ts/admin/shell/legacy-redirects";

describe("legacy admin route redirects", () => {
  it("moves Dashboard and Stats bookmarks to focused System Analytics", () => {
    expect(legacyAdminRedirectTarget("/")).toBe(ADMIN_ANALYTICS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/dashboard?from=bookmark")).toBe(ADMIN_ANALYTICS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/stats")).toBe(ADMIN_ANALYTICS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/stats/registrations?from=bookmark")).toBe(ADMIN_ANALYTICS_REDIRECT_TARGET);
  });

  it("moves Access Control to the portal", () => {
    expect(legacyAdminRedirectTarget("/access-control")).toBe(ADMIN_ACCESS_CONTROL_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/access-control?from=bookmark")).toBe(ADMIN_ACCESS_CONTROL_REDIRECT_TARGET);
  });

  it("moves account settings to the canonical portal route while preserving unrelated routes", () => {
    expect(legacyAdminRedirectTarget("/account")).toBe(ADMIN_ACCOUNT_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/account?from=bookmark")).toBe(ADMIN_ACCOUNT_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/users")).toBe(ADMIN_USERS_REDIRECT_TARGET);
  });

  it("moves user bookmarks to System Users", () => {
    expect(legacyAdminRedirectTarget("/users/detail/user%2F1")).toBe(`${ADMIN_USERS_REDIRECT_TARGET}/user%252F1`);
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

  it("moves organization management to the portal", () => {
    expect(legacyAdminRedirectTarget("/organizations")).toBe(ADMIN_ORGANIZATIONS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/organizations?from=bookmark")).toBe(ADMIN_ORGANIZATIONS_REDIRECT_TARGET);
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

  it("moves donation bookmarks to system management in the portal", () => {
    expect(legacyAdminRedirectTarget("/donations")).toBe(ADMIN_DONATIONS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/donations?from=bookmark")).toBe(ADMIN_DONATIONS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/donations/promoters")).toBe(ADMIN_DONATION_PROMOTERS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/donations/detail/donation-1")).toBe(
      `${ADMIN_DONATIONS_REDIRECT_TARGET}/detail/donation-1`,
    );
  });

  it("moves global leadership management to the System portal", () => {
    expect(legacyAdminRedirectTarget("/leadership")).toBe(ADMIN_LEADERSHIP_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/leadership?from=bookmark")).toBe(ADMIN_LEADERSHIP_REDIRECT_TARGET);
  });

  it("moves sponsorship bookmarks and detail links to System Sponsorships", () => {
    expect(legacyAdminRedirectTarget("/sponsorships")).toBe(ADMIN_SPONSORSHIPS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/sponsorships?from=bookmark")).toBe(ADMIN_SPONSORSHIPS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/sponsorships/sponsor%2F1")).toBe(
      `${ADMIN_SPONSORSHIPS_REDIRECT_TARGET}/sponsor%252F1`,
    );
    expect(legacyAdminRedirectTarget("/sponsorships/sponsor/1")).toBe(
      `${ADMIN_SPONSORSHIPS_REDIRECT_TARGET}/sponsor%2F1`,
    );
  });

  it("moves email and due-work bookmarks to System Operations", () => {
    expect(legacyAdminRedirectTarget("/email")).toBe(ADMIN_OPERATIONS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/email/outbox?from=bookmark")).toBe(ADMIN_OPERATIONS_REDIRECT_TARGET);
    expect(legacyAdminRedirectTarget("/duework")).toBe(ADMIN_OPERATIONS_REDIRECT_TARGET);
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
