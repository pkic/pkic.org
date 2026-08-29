import { describe, expect, it } from "vitest";
import { decorateOpenApiSpec } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/router";

describe("proposal speaker reminder contracts", () => {
  it("documents the typed per-speaker reminder resource", () => {
    const spec = decorateOpenApiSpec(openapi.schema);

    const operation = spec.paths["/api/v1/proposals/{proposalId}/speakers/{userId}/reminders"].post;
    expect(operation).toBeDefined();
    expect(operation.requestBody).toBeDefined();
  });
});
