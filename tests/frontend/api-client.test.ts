// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  ApiClientError,
  patchValidated,
  postJson,
  postValidated,
  putValidated,
  requestJson,
  setErrorPayloadInterceptor,
  setUnauthorizedHandler,
} from "../../assets/ts/shared/api-client";
import { presentationUploadRequest } from "../../assets/shared/presentation-upload";
import { successResponseSchema } from "../../assets/shared/schemas/api-common";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { eventInviteBulkResponseSchema } from "../../assets/shared/schemas/event-invite-bulk";

describe("shared API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
    setErrorPayloadInterceptor(null);
  });

  it("uses an upload content type without combining it with the JSON default", async () => {
    let requestHeaders = new Headers();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestHeaders = new Headers(init?.headers);
      return Response.json({ success: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["%PDF-1.7"], "slides.pdf", { type: "application/pdf" });
    await requestJson("/api/v1/proposals/proposal-1/presentations", successResponseSchema, {
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

    await postJson("/api/v1/proposals/proposal-1/reviews", { recommendation: "accept" }, successResponseSchema);

    expect(requestHeaders.get("content-type")).toBe("application/json");
  });

  it("uses the HTTP status fallback when an error response has no code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    );

    await expect(
      requestJson("/api/v1/proposals/proposal-1/presentations/version-1", successResponseSchema),
    ).rejects.toMatchObject({ code: "HTTP_ERROR", message: "HTTP 500" });
  });

  it("rejects success payloads that do not satisfy the supplied schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: "true" })),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toBeInstanceOf(z.ZodError);
  });

  it("keeps a success-only schema strict and rejects an undeclared payload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: true, jobId: "job-1" })),
    );

    await expect(requestJson("/api/v1/example", successResponseSchema, { method: "POST" })).rejects.toBeInstanceOf(
      z.ZodError,
    );
  });

  it("accepts named payload response schemas without truncating their domain fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ success: true, created: [{ email: "a@example.test" }], endorsed: [], skipped: [] }),
      ),
    );

    await expect(
      requestJson("/api/v1/groups/group/events/event/invites/attendees/bulk", eventInviteBulkResponseSchema),
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

    await expect(requestJson("/api/v1/auth/session", userAuthSessionResponseSchema)).rejects.toBeInstanceOf(z.ZodError);
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

  describe("request-validated helpers", () => {
    const exampleRequestSchema = z.object({
      name: z.string().trim().min(1),
      active: z.boolean().default(true),
    });

    it("parses the body through the request schema before sending, applying schema defaults", async () => {
      let capturedBody: unknown;
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return Response.json({ success: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      await postValidated("/api/v1/example", exampleRequestSchema, { name: "  widget  " }, successResponseSchema);

      expect(exampleRequestSchema.parse(capturedBody)).toEqual({ name: "widget", active: true });
      expect(capturedBody).toEqual({ name: "widget", active: true });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("throws synchronously naming the endpoint and never calls fetch when the body is invalid", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      expect(() => postValidated("/api/v1/example", exampleRequestSchema, { name: "" }, successResponseSchema)).toThrow(
        "/api/v1/example",
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("parses the body for patchValidated and putValidated too", async () => {
      const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(JSON.parse(init?.body as string)).toEqual({ name: "widget", active: true });
        return Response.json({ success: true });
      });
      vi.stubGlobal("fetch", fetchMock);

      await patchValidated("/api/v1/example", exampleRequestSchema, { name: "widget" }, successResponseSchema);
      await putValidated("/api/v1/example", exampleRequestSchema, { name: "widget" }, successResponseSchema);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects patchValidated and putValidated bodies before any fetch when invalid", () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      expect(() =>
        patchValidated("/api/v1/example/patch", exampleRequestSchema, { name: "" }, successResponseSchema),
      ).toThrow("/api/v1/example/patch");
      expect(() =>
        putValidated("/api/v1/example/put", exampleRequestSchema, { name: "" }, successResponseSchema),
      ).toThrow("/api/v1/example/put");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("global interceptors", () => {
    it("throws normally on a 401 when no handler is registered", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 }),
        ),
      );

      await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toBeInstanceOf(ApiClientError);
    });

    it("invokes the registered unauthorized handler exactly once for a 401 response and still throws", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 }),
        ),
      );
      const handler = vi.fn();
      setUnauthorizedHandler(handler);

      await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toBeInstanceOf(ApiClientError);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(401);
    });

    it("calls the unauthorized handler once per in-flight 401 response, so the handler itself must be idempotent", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error: { code: "UNAUTHORIZED", message: "Sign in required." } }, { status: 401 }),
        ),
      );
      const handler = vi.fn();
      setUnauthorizedHandler(handler);

      const results = await Promise.allSettled([
        requestJson("/api/v1/example-a", successResponseSchema),
        requestJson("/api/v1/example-b", successResponseSchema),
      ]);

      expect(results.every((result) => result.status === "rejected")).toBe(true);
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it("does not invoke the unauthorized handler for a non-401 error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 500 })),
      );
      const handler = vi.fn();
      setUnauthorizedHandler(handler);

      await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toBeInstanceOf(ApiClientError);
      expect(handler).not.toHaveBeenCalled();
    });

    it("rewrites an error payload via the registered interceptor", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { error: { code: "SCOPE_REQUIRED", message: "missing scope: proposals:manage" } },
            { status: 403 },
          ),
        ),
      );
      setErrorPayloadInterceptor((payload) =>
        payload.error.code === "SCOPE_REQUIRED" ? { error: { ...payload.error, message: "Sign in again." } } : payload,
      );

      await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toThrow("Sign in again.");
    });

    it("leaves errors the interceptor does not match untouched", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json({ error: { code: "VALIDATION_ERROR", message: "Fix the fields." } }, { status: 422 }),
        ),
      );
      setErrorPayloadInterceptor((payload) =>
        payload.error.code === "SCOPE_REQUIRED" ? { error: { ...payload.error, message: "Sign in again." } } : payload,
      );

      await expect(requestJson("/api/v1/example", successResponseSchema)).rejects.toThrow("Fix the fields.");
    });

    it("lets a call-site mapError further refine an interceptor-mapped payload", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => new Response(null, { status: 500 })),
      );
      setErrorPayloadInterceptor((payload) => payload);

      await expect(
        requestJson("/api/v1/example", successResponseSchema, {
          mapError: (payload) =>
            payload.error.code === "HTTP_ERROR" ? { error: { ...payload.error, message: "Upload failed" } } : payload,
        }),
      ).rejects.toMatchObject({ message: "Upload failed" });
    });
  });
});
