import { describe, expect, it } from "vitest";
import { decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

describe("admin proposal speaker reminder contracts", () => {
  it("documents both per-speaker reminder mutations", () => {
    const spec = decorateOpenApiSpec(openapi.schema);

    expect(spec.paths["/api/v1/admin/proposals/{proposalId}/speakers/{userId}/remind"].post).toBeDefined();
    expect(spec.paths["/api/v1/admin/proposals/{proposalId}/speakers/{userId}/remind-presentation"].post).toBeDefined();
  });
});
