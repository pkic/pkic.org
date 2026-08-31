// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "../../assets/ts/shared/api-client";
import { PERMISSION_DENIED_MESSAGE, PERMISSION_DENIED_WITH_REFRESH_MESSAGE } from "../../assets/shared/auth-errors";
import { successResponseSchema } from "../../assets/shared/schemas/api-common";
import {
  authStatus,
  clearAuth,
  installPortalApiInterceptors,
  portalSession,
  profile,
  savePortalSession,
} from "../../assets/ts/member-flows/portal/state";
import type { PortalSession } from "../../assets/ts/member-flows/portal/types";

const SESSION: PortalSession = {
  success: true,
  identity: { id: "user-1", email: "user@example.test" },
  sponsors: [],
  pendingIdentityCount: 0,
};

function resetPortalState(): void {
  clearAuth();
  window.location.hash = "";
  sessionStorage.clear();
}

describe("portal API interceptors", () => {
  beforeEach(() => {
    resetPortalState();
    installPortalApiInterceptors();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetPortalState();
  });

  it("clears the portal session and records the current path after an unauthorized canonical API error", async () => {
    authStatus.value = "authenticated";
    portalSession.value = SESSION;
    window.location.hash = "#/events/conf-2026/registrations";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 }),
      ),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toThrow();

    expect(authStatus.value).toBe("anonymous");
    expect(portalSession.value).toBeNull();
    expect(profile.value).toBeNull();
    expect(sessionStorage.getItem("pkic_portal_return_path")).toBe("#/events/conf-2026/registrations");
  });

  it("does not record a return path for the default/empty hash", async () => {
    authStatus.value = "authenticated";
    portalSession.value = SESSION;
    window.location.hash = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 }),
      ),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toThrow();

    expect(sessionStorage.getItem("pkic_portal_return_path")).toBeNull();
  });

  it("restores and clears the saved return path once a session is (re-)established", () => {
    sessionStorage.setItem("pkic_portal_return_path", "#/system/donations");
    window.location.hash = "#/";

    savePortalSession(SESSION);

    expect(window.location.hash).toBe("#/system/donations");
    expect(sessionStorage.getItem("pkic_portal_return_path")).toBeNull();
  });

  it("leaves the hash untouched when there is no saved return path", () => {
    window.location.hash = "#/profile";

    savePortalSession(SESSION);

    expect(window.location.hash).toBe("#/profile");
  });

  it("does not expose internal scope names and tells the user to sign in again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "SCOPE_REQUIRED", message: PERMISSION_DENIED_MESSAGE } }, { status: 403 }),
      ),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toThrow(
      PERMISSION_DENIED_WITH_REFRESH_MESSAGE,
    );
  });

  it("leaves non-SCOPE_REQUIRED error messages untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "VALIDATION_ERROR", message: "Fix the fields." } }, { status: 422 }),
      ),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toThrow("Fix the fields.");
  });

  it("clears auth exactly the same way for every in-flight request that reports a 401 for the same expired session", async () => {
    authStatus.value = "authenticated";
    portalSession.value = SESSION;
    window.location.hash = "#/management";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 }),
      ),
    );

    const results = await Promise.allSettled([
      requestJson("/api/v1/example-a", successResponseSchema),
      requestJson("/api/v1/example-b", successResponseSchema),
    ]);

    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(authStatus.value).toBe("anonymous");
    expect(portalSession.value).toBeNull();
    expect(sessionStorage.getItem("pkic_portal_return_path")).toBe("#/management");
  });
});
