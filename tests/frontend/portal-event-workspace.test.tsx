// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import {
  EventWorkspace,
  eventListShowsProposalPrograms,
} from "../../assets/ts/member-flows/portal/sections/events/EventWorkspace";
import { portalSessionFixture } from "../helpers/portal-session";

const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
});

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

describe("event workspace section shell", () => {
  it("names the section with a heading and says it is loading while the view arrives", () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    void act(() => render(<EventWorkspace view="list" />, container));

    // The section opens with the page header's real heading, so the
    // workspace has an entry in the document outline.
    expect(container.querySelector("h2")?.textContent).toBe("Events");
    // The lazy view has not arrived yet, and the wait is announced rather
    // than shown as an empty region.
    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading");
    // The gap under the heading comes from the stack, not from a margin the
    // base layer would zero inside `.pk`.
    expect(container.firstElementChild?.className).toContain("pk-stack");
  });
});
