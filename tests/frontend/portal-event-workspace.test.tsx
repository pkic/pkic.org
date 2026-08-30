// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { eventListShowsProposalPrograms } from "../../assets/ts/member-flows/portal/sections/events/EventWorkspace";
import { portalSessionFixture } from "../helpers/portal-session";

describe("event workspace list view proposal-programs gating", () => {
  it("hides proposal programs for an identity that can already read the events management list at any scope", () => {
    const session = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [{ permission: "events:read", contextType: "event", contextId: "10000000-0000-4000-8000-000000000001" }],
    });
    expect(eventListShowsProposalPrograms(session)).toBe(false);
  });

  it("shows proposal programs for a proposal-only reviewer without events:read at any scope", () => {
    const session = portalSessionFixture({
      staff: true,
      staffRole: "user",
      grants: [
        { permission: "proposals:read", contextType: "event", contextId: "10000000-0000-4000-8000-000000000001" },
      ],
    });
    expect(eventListShowsProposalPrograms(session)).toBe(true);
  });

  it("hides proposal programs for an admin, who holds every permission at every scope", () => {
    expect(eventListShowsProposalPrograms(portalSessionFixture({ staff: true }))).toBe(false);
  });

  it("shows proposal programs when there is no session at all", () => {
    expect(eventListShowsProposalPrograms(null)).toBe(true);
  });
});
