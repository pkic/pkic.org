// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, apiCommand } from "../../assets/ts/admin/api";
import { authStatus, saveAuth } from "../../assets/ts/admin/state";
import { ADMIN_PERMISSION_DENIED_MESSAGE, PERMISSION_DENIED_MESSAGE } from "../../assets/shared/auth-errors";
import { presentationUploadRequest } from "../../assets/shared/presentation-upload";
import { successResponseSchema } from "../../assets/shared/schemas/api-common";
import { adminAuthSessionResponseSchema } from "../../assets/shared/schemas/admin-auth";
import { ApiClientError, requestJson } from "../../assets/ts/shared/api-client";
import { z } from "zod";
import { adminBulkInviteResponseSchema } from "../../assets/shared/schemas/admin-events";

describe("admin API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    authStatus.value = "loading";
  });

  it("uses an upload content type without combining it with the JSON default", async () => {
    let requestHeaders = new Headers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Response.json({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["%PDF-1.7"], "slides.pdf", { type: "application/pdf" });
    await api("/api/v1/admin/proposals/proposal-1/presentation/versions", successResponseSchema, {
      method: "POST",
      ...presentationUploadRequest(file),
    });

    expect(requestHeaders.get("content-type")).toBe("application/pdf");
    expect(requestHeaders.get("x-presentation-file-name")).toBe("slides.pdf");
    expect(requestHeaders.get("x-presentation-file-size")).toBe(String(file.size));
  });

  it("uses JSON as the default content type", async () => {
    let requestHeaders = new Headers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Response.json({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    await api("/api/v1/admin/proposals/proposal-1/reviews", successResponseSchema, {
      method: "POST",
      body: JSON.stringify({ recommendation: "accept" }),
    });

    expect(requestHeaders.get("content-type")).toBe("application/json");
  });

  it("does not expose internal scope names and tells admins to sign in again", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "SCOPE_REQUIRED", message: PERMISSION_DENIED_MESSAGE } }, { status: 403 }),
      ),
    );

    await expect(
      api("/api/v1/admin/proposals/proposal-1/presentation/versions/version-1", successResponseSchema),
    ).rejects.toThrow(ADMIN_PERMISSION_DENIED_MESSAGE);
  });

  it("uses the HTTP status fallback when an error response has no code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    await expect(
      api("/api/v1/admin/proposals/proposal-1/presentation/versions/version-1", successResponseSchema),
    ).rejects.toMatchObject({ code: "HTTP_ERROR", message: "HTTP 500" });
  });

  it("rejects success payloads that do not satisfy the supplied schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: "true" })),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toBeInstanceOf(z.ZodError);
  });

  it("keeps apiCommand success-only and rejects an undeclared payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, jobId: "job-1" })),
    );

    await expect(apiCommand("/api/v1/admin/example", { method: "POST" })).rejects.toBeInstanceOf(z.ZodError);
  });

  it("accepts named payload response schemas without truncating their domain fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ success: true, created: [{ email: "a@example.test" }], endorsed: [], skipped: [] }),
      ),
    );

    await expect(
      api("/api/v1/admin/events/event/invites/attendees/bulk", adminBulkInviteResponseSchema),
    ).resolves.toEqual({
      success: true,
      created: [{ email: "a@example.test" }],
      endorsed: [],
      skipped: [],
    });
  });

  it("rejects incomplete admin session responses before treating the browser as authenticated", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          admin: {
            id: "admin-1",
            email: "admin@pkic.org",
            role: "admin",
            scopes: ["proposals:read"],
            expiresAt: null,
          },
        }),
      ),
    );

    await expect(api("/api/v1/admin/auth/session", adminAuthSessionResponseSchema)).rejects.toBeInstanceOf(z.ZodError);
  });

  it("parses canonical API errors without trusting malformed error bodies", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "VALIDATION_ERROR", message: "Fix the highlighted fields.", details: { fieldErrors: {} } } },
          { status: 422 },
        ),
      ),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Fix the highlighted fields.",
      details: { fieldErrors: {} },
    } satisfies Partial<ApiClientError>);
  });

  it("clears the admin session after an unauthorized canonical API error", async () => {
    saveAuth("admin@example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 }),
      ),
    );

    await expect(api("/api/v1/admin/example", successResponseSchema)).rejects.toBeInstanceOf(ApiClientError);
    expect(authStatus.value).toBe("anonymous");
  });
});
