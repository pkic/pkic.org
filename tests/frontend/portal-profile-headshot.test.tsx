// @vitest-environment jsdom
/**
 * Removing your own headshot from My Profile.
 *
 * The member portal wires the shared `AdminHeadshotManager` to the caller's
 * own `DELETE /api/v1/users/current/headshot`. What a rendering specimen
 * cannot show is the part that matters here: that the control reaches the
 * canonical endpoint, that the removed photo actually leaves the stored
 * profile rather than only the component that removed it, and that a refused
 * removal says so in words a member can act on instead of a transport status.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { myProfileSchema } from "../../assets/shared/schemas/me";
import { MyProfile } from "../../assets/ts/member-flows/portal/sections/MyProfile";
import { profile } from "../../assets/ts/member-flows/portal/state";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["/profile", vi.fn()] }));

const userId = "00000000-0000-4000-8000-000000000041";
const HEADSHOT_URL = `/api/v1/users/${userId}/headshots/stored.jpg`;
const HEADSHOT_ENDPOINT = "/api/v1/users/current/headshot";

let container: HTMLDivElement;
let toastArea: HTMLDivElement;

/**
 * An organization-less member: the identity roster and the organization-page
 * visibility switch belong to `portal-profile-identities.test.tsx`, and
 * leaving them out keeps this file's only network traffic the headshot's own.
 */
function memberProfile(headshotUrl: string | null) {
  return myProfileSchema.parse({
    userId,
    emailId: null,
    email: "member@example.test",
    emailAddresses: [
      {
        id: null,
        email: "member@example.test",
        primary: true,
        verifiedAt: "2026-01-01T00:00:00.000Z",
        verificationMethod: "magic_link",
      },
    ],
    firstName: "Member",
    lastName: "Person",
    preferredName: null,
    jobTitle: null,
    biography: null,
    links: [],
    membershipCategory: "H5",
    organizationId: null,
    organizationName: null,
    memberSince: "2026-01-01",
    showOnOrgProfile: false,
    headshotUrl,
    isOrgContact: false,
    organizationIdentities: null,
    activeIdentities: [
      {
        identityId: "00000000-0000-4000-8000-000000000042",
        memberId: "00000000-0000-4000-8000-000000000043",
        organizationId: null,
        organizationName: null,
        membershipCategory: "H5",
      },
    ],
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function removeButton(): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>("[data-headshot-delete]");
  if (!button) throw new Error("The headshot manager rendered no remove control.");
  return button;
}

function statusText(): string {
  return container.querySelector('[role="status"]')?.textContent ?? "";
}

function toastMessages(): string[] {
  return [...toastArea.querySelectorAll(".pk-toast__message")].map((node) => node.textContent ?? "");
}

/**
 * `deleteHeadshot` is only reached once the native confirmation is accepted
 * (see the controller's note on why this surface still uses `confirm`).
 */
function stubHeadshotEndpoint(respond: (method: string) => Response): Array<{ method: string; url: string }> {
  const requests: Array<{ method: string; url: string }> = [];
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : String(input), location.origin);
      const method = init?.method ?? "GET";
      if (url.pathname === HEADSHOT_ENDPOINT || url.pathname === "/api/v1/users/current") {
        requests.push({ method, url: url.pathname });
        return respond(method);
      }
      // The membership-category catalog is fetched by a hook that keeps its
      // own code-based fallback when the lookup fails.
      throw new Error(`Unexpected request: ${method} ${url.pathname}`);
    }),
  );
  return requests;
}

beforeEach(() => {
  container = document.createElement("div");
  toastArea = document.createElement("div");
  toastArea.id = "portal-toast-area";
  document.body.append(container, toastArea);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  toastArea.remove();
  profile.value = null;
  vi.unstubAllGlobals();
});

describe("removing your own headshot from My Profile", () => {
  it("deletes through the current-user endpoint and drops the photo from the stored profile", async () => {
    const requests = stubHeadshotEndpoint((method) =>
      method === "DELETE" ? json({ success: true }) : json(memberProfile(null)),
    );
    profile.value = memberProfile(HEADSHOT_URL);
    void act(() => render(<MyProfile />, container));
    await settle();

    // The control is only offered when there is something to remove.
    expect(removeButton().hidden).toBe(false);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(HEADSHOT_URL);

    await act(() => removeButton().click());
    await settle();

    expect(requests).toEqual([
      { method: "DELETE", url: HEADSHOT_ENDPOINT },
      // The removal is re-read from the server, not merely assumed.
      { method: "GET", url: "/api/v1/users/current" },
    ]);
    expect(profile.value?.headshotUrl).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("You");
    expect(removeButton().hidden).toBe(true);
    expect(statusText()).toContain("Headshot removed");
    expect(toastMessages()).toContain("Headshot removed");
  });

  it("keeps the photo and says what went wrong when the server refuses the removal", async () => {
    const requests = stubHeadshotEndpoint((method) =>
      method === "DELETE" ? new Response(null, { status: 500 }) : json(memberProfile(null)),
    );
    const stored = memberProfile(HEADSHOT_URL);
    profile.value = stored;
    void act(() => render(<MyProfile />, container));
    await settle();

    await act(() => removeButton().click());
    await settle();

    // No refresh followed a removal that never happened, and the profile the
    // rest of the portal reads is untouched.
    expect(requests).toEqual([{ method: "DELETE", url: HEADSHOT_ENDPOINT }]);
    expect(profile.value).toBe(stored);
    expect(container.querySelector("img")?.getAttribute("src")).toBe(HEADSHOT_URL);
    expect(removeButton().hidden).toBe(false);

    // A transport status is not something a member can act on: both the live
    // region and the toast carry the same sentence, in words.
    expect(statusText()).toContain("Something went wrong on our side");
    expect(statusText()).not.toContain("HTTP 500");
    expect(toastMessages()).toEqual([
      "Something went wrong on our side. Try again, and let us know if it keeps happening.",
    ]);
  });

  it("offers no removal control to a member who has no headshot on file", async () => {
    stubHeadshotEndpoint(() => json(memberProfile(null)));
    profile.value = memberProfile(null);
    void act(() => render(<MyProfile />, container));
    await settle();

    expect(removeButton().hidden).toBe(true);
  });
});
