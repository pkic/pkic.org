import { beforeEach, describe, expect, it } from "vitest";
import { env as workerEnv } from "cloudflare:workers";
import { createMcpOauthTestClient } from "./helpers/mcp-oauth";
import { queryAll, seedEventAndAdmin } from "./helpers/context";
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

  it.each([["events:read"], ["events:read", "agenda:leads_capture"]] as const)(
    "lists events in one request call without discovery or contract loading (%j)",
    async (...scopes) => {
      const { access_token } = await authorize(undefined, scopes);
      const result = value(
        await callTool(access_token, "request", { method: "GET", path: "/api/v1/events", query: { limit: 1 } }),
      );
      expect(result.error).toBeUndefined();
      expect(result.events).toHaveLength(1);
      expect(result.page.limit).toBe(1);
    },
  );

  it("ranks the event collection first in a compact default discovery page", async () => {
    const { access_token } = await authorize(undefined, ["events:read"]);
    const result = value(await callTool(access_token, "discover_operations", { q: "events", method: "GET" }));
    expect(result.page.limit).toBe(5);
    expect(result.operations).toHaveLength(5);
    expect(result.operations[0]).toMatchObject({ path: "/api/v1/events", method: "GET" });
    expect(Object.keys(result.operations[0]).sort()).toEqual(["method", "path", "summary"]);
    expect(JSON.stringify(result).length).toBeLessThan(1800);
  });

  it("keeps live event context grants inside the approved OAuth boundary", async () => {
    const [event] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug='pqc-2026'");
    const [user] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE normalized_email='admin@pkic.org'",
    );
    await env.DB.prepare("UPDATE events SET visibility='invitation_only' WHERE id=?").bind(event.id).run();
    await env.DB.prepare(
      "INSERT INTO events(id,slug,name,timezone,visibility,created_at,updated_at) VALUES (?,'other-private','Other private event','UTC','invitation_only',?,?)",
    )
      .bind(crypto.randomUUID(), new Date().toISOString(), new Date().toISOString())
      .run();
    await env.DB.prepare("DELETE FROM user_roles WHERE user_id=?").bind(user.id).run();
    await env.DB.prepare(
      "INSERT INTO permission_grants(id,user_id,permission,context_type,context_id,created_at) VALUES (?,?,'events:read','event',?,?)",
    )
      .bind(crypto.randomUUID(), user.id, event.id, new Date().toISOString())
      .run();
    const grant = await authorize(undefined, ["events:read"]);
    const list = value(await callTool(grant.access_token, "request", { method: "GET", path: "/api/v1/events" }));
    expect(list.events.map((row: { id: string }) => row.id)).toEqual([event.id]);
    const detail = value(
      await callTool(grant.access_token, "request", { method: "GET", path: "/api/v1/events/pqc-2026" }),
    );
    expect(detail.event.id).toBe(event.id);
    const other = value(
      await callTool(grant.access_token, "request", { method: "GET", path: "/api/v1/events/other-private" }),
    );
    expect(other.error.code).toBe("EVENT_NOT_FOUND");
  });

  it("does not turn unrelated OAuth consent into the user's event access", async () => {
    await env.DB.prepare("UPDATE events SET visibility='invitation_only'").run();
    const [event] = await queryAll<{ id: string }>(env.DB, "SELECT id FROM events WHERE slug='pqc-2026'");
    const [user] = await queryAll<{ id: string }>(
      env.DB,
      "SELECT id FROM users WHERE normalized_email='admin@pkic.org'",
    );
    await env.DB.prepare(
      "INSERT INTO event_participants(id,event_id,user_id,role,status,created_at,updated_at) VALUES (?,?,?,'attendee','active',?,?)",
    )
      .bind(crypto.randomUUID(), event.id, user.id, new Date().toISOString(), new Date().toISOString())
      .run();
    const { access_token } = await authorize(undefined, ["organizations:read"]);
    const result = value(await callTool(access_token, "request", { method: "GET", path: "/api/v1/events" }));
    expect(result.error).toBeUndefined();
    expect(result.events).toEqual([]);
    const detail = value(await callTool(access_token, "request", { method: "GET", path: "/api/v1/events/pqc-2026" }));
    expect(detail.error.code).toBe("EVENT_NOT_FOUND");
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
