import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, vi, type Mock } from "vitest";
import { portalSession } from "../../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../../helpers/portal-session";

/** Mounting, settling and clean-up shared by the portal event list's tests. */
const mounted: HTMLElement[] = [];

export function mount(node: ComponentChildren, view: "grid" | "list" = "list"): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  if (view === "list") {
    const button = [...container.querySelectorAll("button")].find((button) => button.textContent === "List");
    void act(() => button?.click());
  }
  return container;
}

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

/** A member signed in on a fixed day; every mounted list and stub is gone after each test. */
export function useEventListHarness(navigateMock: Mock): void {
  beforeEach(() => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-17T00:00:00.000Z"));
    portalSession.value = portalSessionFixture({ member: true });
  });

  afterEach(() => {
    history.replaceState(null, "", location.pathname);
    for (const container of mounted.splice(0)) {
      void act(() => render(null, container));
      container.remove();
    }
    portalSession.value = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    navigateMock.mockReset();
  });
}
