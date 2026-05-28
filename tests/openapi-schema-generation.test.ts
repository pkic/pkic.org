import { describe, expect, it } from "vitest";
import { AUTH_EXTENSION, decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

describe("OpenAPI schema generation", () => {
  it("generates the full API document", () => {
    expect(() => openapi.schema).not.toThrow();
  });

  it("includes required scopes on decorated admin operations", () => {
    const spec = decorateOpenApiSpec(openapi.schema);
    const operation = spec.paths["/api/v1/admin/proposals/{proposalId}/reviews"].post;

    expect(operation.security).toEqual([{ BearerAuth: ["proposal-reviews:write"] }]);
    expect(operation[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["proposal-reviews:write"],
    });
    expect(operation["x-pkic-required-scopes"]).toEqual(["proposal-reviews:write"]);
    expect(operation.description).toContain("Required scopes: `proposal-reviews:write`.");
  });
});
