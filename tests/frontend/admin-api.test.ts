// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../assets/ts/admin/api";
import { ADMIN_PERMISSION_DENIED_MESSAGE, PERMISSION_DENIED_MESSAGE } from "../../assets/shared/auth-errors";
import { presentationUploadRequest } from "../../assets/shared/presentation-upload";

describe("admin API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses an upload content type without combining it with the JSON default", async () => {
    let requestHeaders = new Headers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Response.json({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["%PDF-1.7"], "slides.pdf", { type: "application/pdf" });
    await api("/api/v1/admin/proposals/proposal-1/presentation/versions", {
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

    await api("/api/v1/admin/proposals/proposal-1/reviews", {
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

    await expect(api("/api/v1/admin/proposals/proposal-1/presentation/versions/version-1")).rejects.toThrow(
      ADMIN_PERMISSION_DENIED_MESSAGE,
    );
  });

  it("uses the HTTP status fallback when an error response has no code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    await expect(api("/api/v1/admin/proposals/proposal-1/presentation/versions/version-1")).rejects.toMatchObject({
      code: "HTTP_ERROR",
      message: "HTTP 500",
    });
  });
});
