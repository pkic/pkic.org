import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountMenu } from "../../assets/ts/ui/AccountMenu";
import { portalDefaultPath } from "../../assets/ts/member-flows/portal/shell/portal-navigation";
import { installPublicAccountMenu } from "../../assets/ts/account-menu";
import { clearAuth } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  recordCanonicalSession: vi.fn(async () => true),
  readActiveUserSession: vi.fn(async () => null),
  readPendingUserLogout: vi.fn(async () => null),
  subscribeUserSessionState: vi.fn(),
}));
vi.mock("../../assets/ts/member-flows/portal/logout-session", () => ({
  resumePendingUserLogout: vi.fn(async () => false),
  signOutPortalSession: vi.fn(async () => clearAuth()),
}));
let mount: HTMLDivElement;
beforeEach(() => {
  clearAuth();
  mount = document.createElement("div");
  mount.id = "pkic-account-menu";
  document.body.append(mount);
});
afterEach(() => {
  void act(() => render(null, mount));
  mount.remove();
  document.getElementById("portal-app")?.remove();
  window.location.hash = "";
  sessionStorage.removeItem("pkic_portal_return_path");
  vi.unstubAllGlobals();
});
it("retains the portal entry for an anonymous visitor", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 401 })),
  );
  await act(async () => installPublicAccountMenu());
  expect(mount.querySelector("a")?.getAttribute("href")).toBe("/portal/");
  expect(mount.querySelector('[aria-label="Account menu"]')).toBeNull();
});
it("uses canonical session claims for the global menu and clears it on sign-out", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      expect(url).toBe("/api/v1/auth/session");
      return new Response(JSON.stringify(portalSessionFixture({ staff: true })), {
        headers: { "content-type": "application/json" },
      });
    }),
  );
  await act(async () => installPublicAccountMenu());
  const trigger = mount.querySelector<HTMLButtonElement>('[aria-label="Account menu"]')!;
  expect(trigger).not.toBeNull();
  expect(mount.textContent).not.toContain("person@example.test");
  await act(async () => trigger.click());
  expect([...mount.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toContain("Portal");
  const signOut = [...mount.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Sign out",
  )!;
  await act(async () => signOut.click());
  expect(mount.querySelector('[aria-label="Account menu"]')).toBeNull();
  expect(mount.querySelector("a")?.getAttribute("href")).toBe("/portal/");
});
it("leaves session ownership to the portal without another request", async () => {
  const portal = document.createElement("div");
  portal.id = "portal-app";
  document.body.append(portal);
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  await installPublicAccountMenu();
  expect(fetch).not.toHaveBeenCalled();
  expect(mount.childElementCount).toBe(0);
});

it("preserves the public fragment and pending portal return path when establishing the session", async () => {
  window.location.hash = "#public-agenda-session";
  const publicUrl = window.location.href;
  sessionStorage.setItem("pkic_portal_return_path", "#/groups");
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(portalSessionFixture({ staff: true })), {
          headers: { "content-type": "application/json" },
        }),
    ),
  );
  await act(async () => installPublicAccountMenu());
  expect(mount.querySelector('[aria-label="Account menu"]')).not.toBeNull();
  expect(window.location.href).toBe(publicUrl);
  expect(sessionStorage.getItem("pkic_portal_return_path")).toBe("#/groups");
});

it("opens the canonical portal destination from the shared account menu", async () => {
  const session = portalSessionFixture({ staff: true });
  const navigate = vi.fn();
  await act(async () =>
    render(<AccountMenu session={session} displayName="Account" headshotUrl={null} navigate={navigate} />, mount),
  );
  await act(async () => mount.querySelector<HTMLButtonElement>('[aria-label="Account menu"]')!.click());
  const portal = [...mount.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "Portal",
  )!;
  await act(async () => portal.click());
  expect(navigate).toHaveBeenCalledWith(portalDefaultPath(session));
});

it("opens the person's own user record from My profile", async () => {
  const session = portalSessionFixture({ staff: true });
  const navigate = vi.fn();
  await act(async () =>
    render(<AccountMenu session={session} displayName="Account" headshotUrl={null} navigate={navigate} />, mount),
  );
  await act(async () => mount.querySelector<HTMLButtonElement>('[aria-label="Account menu"]')!.click());
  const profile = [...mount.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent === "My profile",
  )!;
  await act(async () => profile.click());
  expect(navigate).toHaveBeenCalledWith(`/users/${session.identity.id}`);
});

it("names the signed-in account in the header on the steps before the portal", async () => {
  const { SignedInHeaderMenu } = await import("../../assets/ts/member-flows/portal/shell/SignedInHeaderMenu");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: [], total: 0, limit: 12, offset: 0 })),
  );
  const step = document.createElement("div");
  document.body.append(step);
  await act(() => render(<SignedInHeaderMenu session={portalSessionFixture({ staff: true })} />, step));
  expect(mount.querySelector('[aria-label="Account menu"]')).not.toBeNull();
  await act(() => render(null, step));
  step.remove();
});
