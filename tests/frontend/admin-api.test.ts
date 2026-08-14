// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../../assets/ts/admin/api";
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
});
