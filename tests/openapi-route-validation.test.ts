import { fromHono } from "chanfana";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OPENAPI_JSON_MAX_BYTES, openApiRoute } from "../functions/_lib/openapi/route";
import { AppError } from "../functions/_lib/errors";

function testApp() {
  const app = new Hono();
  app.onError((error) => {
    if (error instanceof AppError) return Response.json({ code: error.code }, { status: error.status });
    throw error;
  });
  const openapi = fromHono(app);
  const routeSchema = {
    request: {
      body: {
        content: {
          "application/json": { schema: z.object({ value: z.string() }) },
        },
        required: true,
      },
    },
    responses: { "200": { description: "Validated test response." } },
  };
  openapi.post(
    "/test",
    openApiRoute(routeSchema, (_context, data) => Response.json({ value: data.body.value })),
  );
  return app;
}

describe("shared OpenAPI request validation", () => {
  it("performs one bounded JSON parse and reuses the result for validation", async () => {
    const app = testApp();

    const requestJson = vi.spyOn(Request.prototype, "json");
    const requestClone = vi.spyOn(Request.prototype, "clone");
    try {
      const response = await app.request("/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "validated" }),
      });

      expect(response.status).toBe(200);
      expect(JSON.parse(await response.text())).toEqual({ value: "validated" });
      expect(requestJson).not.toHaveBeenCalled();
      expect(requestClone).not.toHaveBeenCalled();
    } finally {
      requestJson.mockRestore();
      requestClone.mockRestore();
    }
  });

  it("rejects malformed JSON through the same shared boundary", async () => {
    const response = await testApp().request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "INVALID_JSON" });
  });

  it("rejects JSON bodies above the shared streaming limit", async () => {
    const response = await testApp().request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array(OPENAPI_JSON_MAX_BYTES + 1),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ code: "REQUEST_BODY_TOO_LARGE" });
  });
});
