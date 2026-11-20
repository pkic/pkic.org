import { eventVirtualRoomUrl } from "../assets/shared/event-participation-link";
import { buildEventEmailVariables } from "../functions/_lib/email/event-email-variables";
import { describe, expect, it } from "vitest";
import { buildManagementLink } from "../functions/_lib/services/management-links";
import { registrationPageUrl } from "../functions/_lib/services/frontend-links";

describe("semantic management links", () => {
  const appBaseUrl = "https://app.test";

  it("builds current hash destinations for global management queues", () => {
    expect(buildManagementLink(appBaseUrl, { kind: "organization-content-reviews" })).toBe(
      "https://app.test/portal/#/settings/organization-content-reviews",
    );
    expect(buildManagementLink(appBaseUrl, { kind: "membership-application", id: "application-1" })).toBe(
      "https://app.test/portal/#/membership/applications/application-1",
    );
    expect(buildManagementLink(appBaseUrl, { kind: "sponsorship-list" })).toBe("https://app.test/portal/#/sponsors");
    expect(buildManagementLink(appBaseUrl, { kind: "sponsorship", id: "sponsor/1" })).toBe(
      "https://app.test/portal/#/sponsors/sponsor%2F1",
    );
  });

  it("builds MCP authorization links with only a short request reference", () => {
    expect(
      buildManagementLink(appBaseUrl, { kind: "mcp-oauth", requestId: "00000000-0000-4000-8000-000000000001" }),
    ).toBe("https://app.test/portal/#/auth/oauth?request=00000000-0000-4000-8000-000000000001");
  });
});

describe("system event virtual room links", () => {
  const event = {
    name: "Conference",
    slug: "conference",
    base_path: "/events/2026/conference/",
    starts_at: "2026-12-01T09:00:00.000Z",
    settings_json: '{"virtualUrl":"https://obsolete.example.test/room"}',
  };

  it("uses the authenticated attendee room rather than a stored external override", () => {
    expect(eventVirtualRoomUrl(event.slug, "https://app.test/")).toBe(
      "https://app.test/portal/#/events/conference/virtual",
    );
    expect(eventVirtualRoomUrl("conference/one", "https://app.test/")).toBe(
      "https://app.test/portal/#/events/conference%2Fone/virtual",
    );
  });

  it("provides the same canonical room to event email templates", () => {
    expect(buildEventEmailVariables(event, "https://app.test").virtualRoomUrl).toBe(
      eventVirtualRoomUrl(event.slug, "https://app.test"),
    );
  });
});

describe("invitation registration links", () => {
  const event = {
    slug: "conference",
    base_path: "/events/conference/",
    starts_at: "2026-12-01T09:00:00.000Z",
    settings_json: "{}",
    source_mode: "portal",
  } as const;
  const invitation = { invite: "token-1", inviteId: "invite-1", source: "invite_resend" };

  it("opens registration in the portal for an event without public pages", () => {
    const link = new URL(
      registrationPageUrl("https://app.test", { ...event, visibility: "invitation_only" }, invitation),
    );
    expect(link.pathname).toBe("/portal/");
    expect(link.hash).toBe("#/events/conference/register?invite=token-1&id=invite-1&source=invite_resend");
  });

  it("keeps the public registration page for a public event", () => {
    const link = new URL(registrationPageUrl("https://app.test", { ...event, visibility: "public" }, invitation));
    expect(link.pathname).toBe("/events/conference/register/");
    expect(link.searchParams.get("invite")).toBe("token-1");
  });
});
