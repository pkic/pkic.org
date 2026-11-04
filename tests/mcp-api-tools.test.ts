import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { createMcpOauthTestClient } from "./helpers/mcp-oauth";
import { seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import { filterOpenApiSpecForMcp } from "../functions/_lib/openapi/mcp";
import { openapi } from "../functions/http-router";

const env = { ...workerEnv, INTERNAL_SIGNING_SECRET: "synthetic-oauth-test-signing-secret-32-plus" };
const { callTool, authorize, initialize } = createMcpOauthTestClient(env);

function value(result: { content: { type: string; text?: string }[] }) {
  return JSON.parse(result.content.find((item) => item.type === "text")!.text!);
}

describe("generic MCP API helpers", () => {
  beforeEach(async () => {
    await resetDb();
    await seedEventAndAdmin(env.DB);
  });

  it("includes generated API operations without duplicating their request contracts", () => {
    const spec = openapi.schema;
    const filtered = filterOpenApiSpecForMcp(spec);
    const paths = spec.paths as Record<
      string,
      Record<
        string,
        {
          requestBody?: { content?: Record<string, unknown> };
          responses?: Record<string, { content?: Record<string, unknown> }>;
          "x-pkic-mcp"?: { expose?: boolean };
        }
      >
    >;
    for (const [path, item] of Object.entries(paths)) {
      if (!path.startsWith("/api/v1/")) continue;
      for (const method of ["get", "post", "put", "patch", "delete"] as const) {
        const operation = item[method];
        if (!operation || operation["x-pkic-mcp"]?.expose === false) continue;
        const mediaTypes = [
          ...Object.keys(operation.requestBody?.content ?? {}),
          ...Object.entries(operation.responses ?? {}).flatMap(([status, response]) =>
            /^2\d\d$/.test(status) ? Object.keys(response.content ?? {}) : [],
          ),
        ];
        if (mediaTypes.some((type) => type !== "application/json" && !type.endsWith("+json"))) continue;
        expect(filtered.paths[path]?.[method], `${method} ${path}`).toBeDefined();
        expect(filtered.paths[path][method].requestBody).toEqual(
          (spec.paths as Record<string, Record<string, { requestBody?: unknown }>>)[path][method].requestBody,
        );
      }
    }
  });

  it("discovers and inspects owning-group contracts without executing an action", async () => {
    const { access_token: token } = await authorize();
    expect((await initialize(token)).status).toBe(200);
    const query = { q: "/groups/", method: "GET", limit: 1, offset: 0 };
    const first = value(await callTool(token, "discover_operations", query));
    expect(first.operations).toHaveLength(1);
    expect(first.page.hasMore).toBe(true);
    const second = value(await callTool(token, "discover_operations", { ...query, offset: 1 }));
    expect(second.operations[0].path).not.toBe(first.operations[0].path);
    expect(first.operations[0]).not.toHaveProperty("responses");

    const path = "/api/v1/groups/{groupId}/events/{eventId}/settings";
    const inspected = value(await callTool(token, "inspect_operation", { path, method: "PATCH" }));
    const expected = filterOpenApiSpecForMcp(openapi.schema).paths[path];
    expect(expected.patch).toBeDefined();
    expect(inspected.operation).toBeDefined();
    expect(inspected.operation.requestBody).toEqual(expected.patch.requestBody);
    expect(inspected.operation.responses).toBeUndefined();
    const full = value(await callTool(token, "inspect_operation", { path, method: "PATCH", section: "all" }));
    expect(full.operation).toEqual(expected.patch);
    expect(await callTool(token, "inspect_operation", { path: "/missing", method: "GET" })).toMatchObject({
      isError: true,
    });
  });

  it("keeps API refusals and bounded results separate in an ordered read batch", async () => {
    const { access_token: token } = await authorize();
    const result = value(
      await callTool(token, "batch_read", {
        requests: [
          { path: "/api/v1/organizations", query: { limit: 1 } },
          { path: "/api/v1/email/outbox", query: { limit: 1 } },
          { path: "https://outside.test/api/v1/organizations" },
          { path: "/api/v1/openapi.json" },
        ],
      }),
    );
    expect(result.results[0]).toMatchObject({ index: 0, result: { page: { limit: 1 } } });
    expect(result.results[1]).toMatchObject({ index: 1, result: { error: { code: expect.any(String) } } });
    expect(result.results[2]).toMatchObject({ index: 2, error: expect.any(String) });
    expect(result.results[3]).toMatchObject({ index: 3, error: expect.any(String) });
    const direct = value(
      await callTool(token, "request", { method: "GET", path: "/api/v1/organizations", query: { limit: 1 } }),
    );
    expect(direct.page.limit).toBe(1);
    expect(await callTool(token, "batch_read", { requests: [] })).toMatchObject({ isError: true });
    expect(
      await callTool(token, "batch_read", { requests: [{ path: "/api/v1/organizations", method: "POST" }] }),
    ).toMatchObject({ isError: true });
    expect(
      await callTool(token, "batch_read", { requests: Array(11).fill({ path: "/api/v1/organizations" }) }),
    ).toMatchObject({ isError: true });
  });
});
