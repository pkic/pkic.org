// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccountSettings } from "../../assets/ts/member-flows/portal/sections/AccountSettings";
import { profile, portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("../../assets/ts/components/passkey-settings", () => ({
  PasskeySettings: () => <div>Passkeys</div>,
}));

let container: HTMLDivElement;

function mount(node: ComponentChildren): void {
  void act(() => render(node, container));
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  profile.value = null;
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  portalSession.value = null;
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("portal account settings capacity cutover", () => {
  it("renders for a staff-only identity without calling member-only APIs", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        requests.push(new URL(url, location.origin).pathname);
        throw new Error(`Unexpected member API request: ${url}`);
      }),
    );
    portalSession.value = portalSessionFixture({ admin: true });

    mount(<AccountSettings />);
    await settle();

    expect(container.textContent).toContain("person@example.test");
    expect(container.textContent).toContain("Passkeys");
    expect(container.textContent).not.toContain("Notification preferences");
    expect(requests).toEqual([]);
  });

  it.each([
    ["member-only", { member: true }],
    ["dual-capacity", { admin: true, member: true }],
  ] as const)("loads notification preferences for a %s identity", async (_label, capacities) => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url.pathname);
        if (url.pathname === "/api/v1/me/notification-preferences") {
          return jsonResponse({
            workingGroupUpdates: true,
            voteReminders: true,
            generalAnnouncements: true,
            wgChairMembershipDigest: false,
          });
        }
        throw new Error(`Unexpected request: ${url}`);
      }),
    );
    portalSession.value = portalSessionFixture(capacities);

    mount(<AccountSettings />);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(container.textContent).toContain("Notification preferences");
    expect(requests).toEqual(["/api/v1/me/notification-preferences"]);
  });
});
