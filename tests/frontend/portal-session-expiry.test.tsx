// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  clearAuth,
  isAuthed,
  portalSession,
  profile,
  savePortalSession,
} from "../../assets/ts/member-flows/portal/state";
import { useSessionExpiry } from "../../assets/ts/member-flows/portal/use-session-expiry";
import { portalSessionFixture } from "../helpers/portal-session";

let root: HTMLDivElement;
function Harness() {
  useSessionExpiry();
  return <div>{isAuthed.value ? "Private organization and user details" : "Sign in"}</div>;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-18T12:00:00.000Z"));
  clearAuth();
  sessionStorage.clear();
  root = document.createElement("div");
  document.body.append(root);
});
afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
  clearAuth();
  vi.useRealTimers();
});
async function signIn(milliseconds = 1000, staff = false) {
  const session = portalSessionFixture({ member: true, staff });
  session.expiresAt = new Date(Date.now() + milliseconds).toISOString();
  if (session.staff) session.staff.expiresAt = new Date(Date.now() + 500).toISOString();
  await act(async () => {
    savePortalSession(session);
    render(<Harness />, root);
  });
}
it("removes private content at expiry without any network request and preserves the return path", async () => {
  window.location.hash = "#/organizations/example";
  await signIn();
  expect(root.textContent).toContain("Private organization");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(root.textContent).toBe("Sign in");
  expect(portalSession.value).toBeNull();
  expect(profile.value).toBeNull();
  expect(sessionStorage.getItem("pkic_portal_return_path")).toBe("#/organizations/example");
});
it("checks the deadline immediately when a suspended page returns", async () => {
  await signIn();
  vi.setSystemTime(new Date(Date.now() + 2000));
  await act(async () => {
    window.dispatchEvent(new Event("pageshow"));
  });
  expect(root.textContent).toBe("Sign in");
});
it("uses the earlier staff deadline and cancels an old session timer after sign-in", async () => {
  await signIn(1000);
  await signIn(5000);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(root.textContent).toContain("Private organization");
  await signIn(5000, true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500);
  });
  expect(root.textContent).toBe("Sign in");
});
it("refuses a session response that has already expired", () => {
  const session = portalSessionFixture({ member: true });
  session.expiresAt = new Date(Date.now() - 1).toISOString();
  savePortalSession(session);
  expect(isAuthed.value).toBe(false);
});
