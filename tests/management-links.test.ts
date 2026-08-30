import { describe, expect, it } from "vitest";
import { buildManagementLink } from "../functions/_lib/services/management-links";

describe("semantic management links", () => {
  const appBaseUrl = "https://app.test";

  it("builds current hash destinations for global management queues", () => {
    expect(buildManagementLink(appBaseUrl, { kind: "organization-content-reviews" })).toBe(
      "https://app.test/portal/#/system/organization-content-reviews",
    );
    expect(buildManagementLink(appBaseUrl, { kind: "membership-application", id: "application-1" })).toBe(
      "https://app.test/portal/#/system/membership-applications/application-1",
    );
    expect(buildManagementLink(appBaseUrl, { kind: "sponsorship-list" })).toBe("https://app.test/portal/#/sponsors");
    expect(buildManagementLink(appBaseUrl, { kind: "sponsorship", id: "sponsor/1" })).toBe(
      "https://app.test/portal/#/sponsors/sponsor%2F1",
    );
  });

  it("builds MCP authorization links while preserving the sanitized return target", () => {
    expect(
      buildManagementLink(appBaseUrl, {
        kind: "mcp-oauth",
        returnTo: "/api/v1/auth/oauth/authorize?client_id=client-1",
        token: "oauth-token",
        error: "denied",
      }),
    ).toBe(
      "https://app.test/portal/#/auth/oauth?return_to=%2Fapi%2Fv1%2Fauth%2Foauth%2Fauthorize%3Fclient_id%3Dclient-1&token=oauth-token&error=denied",
    );
  });
});
