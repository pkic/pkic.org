// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { menuPath } from "./helpers/menu-path";
import { registrationList, json } from "./helpers/group-event-attendance-fixtures";
import { groupEventWorkspaceFixture as baseEvent, GROUP_ID } from "./helpers/group-event-workspace-fixture";
import { portalSessionFixture } from "../helpers/portal-session";
import { savePortalSession, clearAuth } from "../../assets/ts/member-flows/portal/state";
import { GroupEventWorkspace } from "../../assets/ts/member-flows/portal/sections/management/GroupEventWorkspace";
const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
const mounted: HTMLElement[] = [];
async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
async function mount(node: ComponentChildren) {
  const host = document.createElement("div");
  document.body.append(host);
  mounted.push(host);
  await act(async () => {
    render(node, host);
    await vi.dynamicImportSettled();
  });
  await settle();
  return host;
}
afterEach(async () => {
  for (const host of mounted.splice(0)) {
    await act(() => render(null, host));
    host.remove();
  }
  vi.unstubAllGlobals();
  navigate.mockReset();
});

it.each(["cancel", "registration", "badges", "event", "group"])(
  "keeps output on the roster and cancels it on %s",
  async (destination) => {
    savePortalSession(portalSessionFixture({ administrator: true }));
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname.endsWith("/days")) return json({ days: [], eventUpdatedAt: "2026-01-01T00:00:00Z" });
        if (url.pathname.endsWith("/population")) return new Promise<Response>(() => {});
        return json(registrationList());
      }),
    );
    try {
      const event = baseEvent({ capabilities: ["view", "manage", "manage_attendance"] });
      const container = await mount(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="registrations" />);
      await vi.waitFor(async () => {
        await settle();
        expect(container.querySelector('button[aria-label="Registration actions"]')).not.toBeNull();
      });
      navigate.mockClear();
      const download = await menuPath(container, "Registration actions", ["Download", "CSV", "Labels"]);
      await act(() => download.click());
      await vi.dynamicImportSettled();
      await vi.waitFor(async () => {
        await settle();
        expect(container.querySelector("dialog")?.textContent).toContain("Download labels CSV");
      });
      expect(navigate).not.toHaveBeenCalled();
      expect(container.querySelector('nav[aria-label="Registration sections"]')).not.toBeNull();
      if (destination === "cancel") {
        const cancel = [...container.querySelectorAll("dialog button")].find((item) => item.textContent === "Cancel");
        await act(() => (cancel as HTMLButtonElement).click());
      } else {
        await act(() =>
          render(
            <GroupEventWorkspace
              event={destination === "event" ? { ...event, id: "another-workshop" } : event}
              groupId={destination === "group" ? "another-group" : GROUP_ID}
              tab="registrations"
              detailId={
                destination === "registration"
                  ? "30000000-0000-4000-8000-000000000001"
                  : destination === "badges"
                    ? "badges"
                    : undefined
              }
            />,
            container,
          ),
        );
        await vi.dynamicImportSettled();
        await settle();
      }
      expect(container.querySelector("dialog")).toBeNull();
      expect(navigate).not.toHaveBeenCalled();
      if (destination !== "cancel") {
        await act(() =>
          render(<GroupEventWorkspace event={event} groupId={GROUP_ID} tab="registrations" />, container),
        );
        await settle();
        expect(container.querySelector("dialog")).toBeNull();
      }
    } finally {
      clearAuth();
    }
  },
);
