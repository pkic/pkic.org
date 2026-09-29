// @vitest-environment jsdom
/**
 * The sponsor workspace's own shell: which views a capacity set reaches, and
 * how it says so.
 *
 * These tabs swap a panel that is already on the page — nothing navigates — so
 * they are the ARIA tab pattern, not links. The Bootstrap version rendered
 * them as buttons carrying `aria-current="page"`, which claims to be the
 * current *page* about something that is not a page, and left the panel
 * unconnected to the tab that controls it. The panels themselves are stubbed:
 * what is under test is the shell, not the three collections it hosts.
 */
import { render, type ComponentChild } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SponsorCapacity } from "../../assets/shared/schemas/sponsor-access";
import { SponsorWorkspace } from "../../assets/ts/member-flows/portal/sections/sponsors";
import { tabNames, tabs } from "./helpers/tabs";

vi.mock("../../assets/ts/member-flows/portal/sections/sponsors/management", () => ({
  Sponsorships: () => <p>sponsorships panel</p>,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/sponsors/Attendees", () => ({
  SponsorAttendees: () => <p>attendees panel</p>,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/sponsors/management/SponsorshipTierConfig", () => ({
  SponsorshipTierConfig: () => <p>tier pricing panel</p>,
}));

function capacity(overrides: Partial<SponsorCapacity> = {}): SponsorCapacity {
  return {
    sponsorId: "00000000-0000-4000-8000-000000000001",
    eventSlug: "pqc-2026",
    eventName: "PQC Conference 2026",
    tier: "gold",
    ...overrides,
  } as SponsorCapacity;
}

let container: HTMLElement | null = null;

function mount(node: ComponentChild): HTMLElement {
  container = document.createElement("div");
  document.body.append(container);
  void act(() => render(node, container!));
  return container;
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.clearAllMocks();
});

describe("sponsor workspace shell", () => {
  it("announces a session with no sponsor access rather than leaving a muted line", () => {
    const workspace = mount(
      <SponsorWorkspace sponsors={[]} canRead={false} canWrite={false} onSessionExpired={vi.fn()} />,
    );

    const empty = workspace.querySelector("[role='status']");
    expect(empty?.textContent).toContain("No sponsor access is assigned to this session.");
    expect(tabs(workspace)).toHaveLength(0);
  });

  it("renders switching tabs as the ARIA tab pattern, each naming the panel it controls", () => {
    const workspace = mount(<SponsorWorkspace sponsors={[capacity()]} canRead canWrite onSessionExpired={vi.fn()} />);

    expect(tabNames(workspace)).toEqual(["Management", "Attendees", "Settings"]);

    const strip = workspace.querySelector("[role='tablist']");
    expect(strip?.getAttribute("aria-label")).toBe("Sponsor workspace");

    const [management] = tabs(workspace);
    // A tab, not a link claiming to be the current page.
    expect(management.tagName.toLowerCase()).toBe("button");
    expect(management.getAttribute("aria-selected")).toBe("true");
    expect(management.getAttribute("aria-current")).toBeNull();

    const panelId = management.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const panel = workspace.querySelector(`[id="${panelId!}"]`);
    expect(panel?.getAttribute("role")).toBe("tabpanel");
    expect(panel?.getAttribute("aria-labelledby")).toBe(management.id);
  });

  it("keeps exactly one tab in the tab order, so the arrows move within the set", () => {
    const workspace = mount(<SponsorWorkspace sponsors={[capacity()]} canRead canWrite onSessionExpired={vi.fn()} />);

    expect(tabs(workspace).map((tab) => tab.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("shows only the tabs a capacity set actually reaches", () => {
    const workspace = mount(
      <SponsorWorkspace sponsors={[capacity()]} canRead={false} canWrite={false} onSessionExpired={vi.fn()} />,
    );

    // One reachable view is not a choice, so no strip is drawn at all.
    expect(tabs(workspace)).toHaveLength(0);
    expect(workspace.textContent).toContain("attendees panel");
  });

  it("names the sponsorship picker through a for/id pair when a viewer holds several", () => {
    const workspace = mount(
      <SponsorWorkspace
        sponsors={[capacity(), capacity({ sponsorId: "00000000-0000-4000-8000-000000000002", tier: "silver" })]}
        canRead={false}
        canWrite={false}
        onSessionExpired={vi.fn()}
      />,
    );

    const label = [...workspace.querySelectorAll("label")].find((candidate) => candidate.textContent === "Sponsorship");
    expect(label).toBeDefined();
    const select = workspace.querySelector<HTMLSelectElement>(`[id="${label!.htmlFor}"]`);
    expect(select?.tagName.toLowerCase()).toBe("select");
    expect([...select!.options].map((option) => option.textContent)).toEqual([
      "PQC Conference 2026 — gold",
      "PQC Conference 2026 — silver",
    ]);
  });

  it("falls back to a reachable view when the selected one is no longer available", () => {
    // A capacity change can strip the tab the workspace is sitting on. It
    // falls back rather than stranding the reader on an empty panel.
    const workspace = mount(<SponsorWorkspace sponsors={[]} canRead canWrite={false} onSessionExpired={vi.fn()} />);

    expect(tabs(workspace)).toHaveLength(0);
    expect(workspace.textContent).toContain("sponsorships panel");
  });
});
