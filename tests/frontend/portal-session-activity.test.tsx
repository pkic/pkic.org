// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  SESSION_ACTIVITY_REFRESH_INTERVAL_MS,
  useSessionActivity,
} from "../../assets/ts/member-flows/portal/use-session-activity";
import { clearAuth, portalSession, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { portalSessionFixture } from "../helpers/portal-session";

let root: HTMLDivElement;

function Harness() {
  useSessionActivity();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-28T12:00:00.000Z"));
  clearAuth();
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(async () => {
  await act(() => render(null, root));
  root.remove();
  clearAuth();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("turns browser interaction into one throttled live-session refresh", async () => {
  const initial = portalSessionFixture({ member: true, staff: true });
  initial.expiresAt = "2026-10-28T12:00:00.000Z";
  initial.idleExpiresAt = "2026-10-05T12:00:00.000Z";
  initial.staff!.expiresAt = "2026-09-28T20:00:00.000Z";
  initial.staff!.idleExpiresAt = "2026-09-28T13:00:00.000Z";
  const refreshed = structuredClone(initial);
  refreshed.idleExpiresAt = "2026-10-05T12:15:00.000Z";
  refreshed.staff!.idleExpiresAt = "2026-09-28T13:15:00.000Z";
  const fetchMock = vi.fn(async () => Response.json(refreshed));
  vi.stubGlobal("fetch", fetchMock);

  await act(async () => {
    savePortalSession(initial);
    render(<Harness />, root);
  });
  document.dispatchEvent(new Event("pointerdown"));
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
  expect(fetchMock).not.toHaveBeenCalled();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(SESSION_ACTIVITY_REFRESH_INTERVAL_MS);
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/v1/auth/session",
    expect.objectContaining({ credentials: "same-origin", method: "GET" }),
  );
  expect(portalSession.value?.idleExpiresAt).toBe(refreshed.idleExpiresAt);
  expect(portalSession.value?.staff?.idleExpiresAt).toBe(refreshed.staff!.idleExpiresAt);
});

it("fails closed when the server refuses an activity refresh", async () => {
  const initial = portalSessionFixture({ member: true });
  initial.expiresAt = "2026-10-28T12:00:00.000Z";
  initial.idleExpiresAt = "2026-10-05T12:00:00.000Z";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: { code: "AUTH_FORBIDDEN", message: "Sign in again" } }, { status: 403 })),
  );

  await act(async () => {
    savePortalSession(initial);
    render(<Harness />, root);
  });
  document.dispatchEvent(new Event("pointerdown"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SESSION_ACTIVITY_REFRESH_INTERVAL_MS);
  });
  expect(portalSession.value).toBeNull();
});
