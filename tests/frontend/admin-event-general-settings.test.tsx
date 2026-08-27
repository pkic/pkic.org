// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventDetail } from "../../assets/ts/admin/types";
import { GeneralTab } from "../../assets/ts/admin/sections/events/detail/settings/GeneralTab";

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const portalEvent = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "portal-workshop",
  name: "Portal workshop",
  timezone: "Europe/Amsterdam",
  starts_at: "2026-09-01T15:00:00.000Z",
  ends_at: "2026-09-01T16:00:00.000Z",
  registration_mode: "invite_or_open",
  invite_limit_attendee: 5,
  base_path: null,
  user_retention_days: null,
  venue: null,
  virtual_url: null,
  hero_image_url: null,
  location: null,
  session_types: null,
  ownerGroupId: "20000000-0000-4000-8000-000000000001",
  sourceMode: "portal",
  settings: { forms: { event_registration: "legacy-attendee-form" } },
} as EventDetail;

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("admin event general settings", () => {
  it("does not render or submit portal-owned attendee registration controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        expect(url.pathname).toContain("/forms");
        return json({ forms: [], page: { limit: 100, offset: 0, total: 0, hasMore: false } });
      }),
    );

    const onUpdated = vi.fn();
    const container = mount(<GeneralTab event={portalEvent} onUpdated={onUpdated} />);
    await settle();
    expect(container.textContent).not.toContain("Registration form");
    expect(container.textContent).not.toContain("Registration Mode");
    expect(container.textContent).toContain("Proposal form");
  });
});
