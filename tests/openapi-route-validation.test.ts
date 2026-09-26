import { fromHono } from "chanfana";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OPENAPI_JSON_MAX_BYTES, openApiRoute } from "../functions/_lib/openapi/route";
import { AppError } from "../functions/_lib/errors";
import { apiValidationErrorDetailsSchema } from "../assets/shared/schemas/api-common";

function testApp() {
  const app = new Hono();
  app.onError((error) => {
    if (error instanceof AppError) {
      return Response.json({ code: error.code, details: error.details ?? null }, { status: error.status });
    }
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
    expect(await response.json()).toMatchObject({ code: "INVALID_JSON" });
  });

  it("reports refused fields through the shared {formErrors, fieldErrors} details contract", async () => {
    const response = await testApp().request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: 42 }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; details: unknown };
    expect(body.code).toBe("VALIDATION_ERROR");
    // The browser's shared validation-map helpers read exactly this shape and
    // pin each message to the field it names; chanfana's own `[{code, message,
    // path}]` entries would reach the reader as a bare "Invalid request".
    const details = apiValidationErrorDetailsSchema.parse(body.details);
    expect(details.formErrors).toEqual([]);
    // The `body` segment is transport framing, not a field name.
    expect(Object.keys(details.fieldErrors ?? {})).toEqual(["value"]);
    expect(details.fieldErrors?.value?.[0]).toMatch(/string/i);
  });

  it("reports a request that is not an object as a form-level error, not a field", async () => {
    const response = await testApp().request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify("not-an-object"),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string; details: unknown };
    expect(body.code).toBe("VALIDATION_ERROR");
    const details = apiValidationErrorDetailsSchema.parse(body.details);
    expect(details.fieldErrors).toEqual({});
    expect(details.formErrors?.length).toBeGreaterThan(0);
  });

  it("rejects JSON bodies above the shared streaming limit", async () => {
    const response = await testApp().request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new Uint8Array(OPENAPI_JSON_MAX_BYTES + 1),
    });

    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "REQUEST_BODY_TOO_LARGE" });
  });
});

/**
 * A list endpoint has no notion of "filter by the empty string".
 *
 * `?q=` is what a cleared search box, an unset filter or a hand-built query
 * string sends. chanfana's `coerceInputs` turns the empty value into `null`,
 * which every optional field in the shared list contract refuses with
 * "expected string, received null" — so the whole list came back 400 and the
 * surface rendered nothing. That is what issue #11 reported as representatives
 * failing to appear and members failing to list, and it reached every list
 * endpoint at once, because they all validate through this wrapper.
 */
describe("an empty query parameter", () => {
  function listApp() {
    const app = new Hono();
    app.onError((error) => {
      if (error instanceof AppError) {
        return Response.json({ code: error.code, details: error.details ?? null }, { status: error.status });
      }
      throw error;
    });
    const openapi = fromHono(app);
    openapi.get(
      "/list",
      openApiRoute(
        {
          request: {
            query: z.object({
              q: z.string().min(1).optional(),
              group: z.enum(["all", "organization"]).default("all"),
              limit: z.coerce.number().int().min(1).max(200).default(50),
            }),
          },
          responses: { "200": { description: "A page." } },
        },
        (_context, data) => Response.json({ received: data.query }),
      ),
    );
    return app;
  }

  it("is read as absent, so the field takes its default", async () => {
    const response = await listApp().request("/list?q=&group=&limit=");
    expect(response.status).toBe(200);
    // Not `null`, and not the empty string: the parameter was never supplied.
    expect(await response.json()).toEqual({ received: { group: "all", limit: 50 } });
  });

  it("still carries a value the caller did supply", async () => {
    const response = await listApp().request("/list?q=acme&group=organization&limit=10");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: { q: "acme", group: "organization", limit: 10 } });
  });

  it("does not excuse a value that is genuinely wrong", async () => {
    // Dropping empties must not turn the validator off: a filter set to a
    // value the contract does not offer is still refused.
    const response = await listApp().request("/list?group=nonsense");
    expect(response.status).toBe(400);
  });
});
