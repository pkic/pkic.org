import { describe, expect, it, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createCatalogSource } from "../functions/_lib/api-tools/catalog-source";
import { buildMcpCatalog, MCP_CATALOG_PATH, MCP_CONTRACTS_PATH } from "../functions/_lib/openapi/mcp-catalog";
import { buildMcpDomains } from "../functions/_lib/openapi/mcp-domains";
import { registerDomainTools } from "../functions/_lib/api-tools/domain-tools";
import { registerExecuteTools } from "../functions/_lib/api-tools/execute-tools";
import { openapi } from "../functions/http-router";
import { filterOpenApiSpecForMcp } from "../functions/_lib/openapi/mcp";

describe("MCP schema delivery", () => {
  it("loads only the compact index and a selected contract from build assets", async () => {
    const canonical = {
      paths: { "/api/v1/example": { post: { summary: "Example", requestBody: { sentinel: "canonical schema" } } } },
    };
    const { catalog, contracts } = buildMcpCatalog(canonical);
    expect(catalog[0]).not.toHaveProperty("requestBody");
    const fetch = vi.fn(async (request: Request) => {
      const path = new URL(request.url).pathname;
      if (path === MCP_CATALOG_PATH) return Response.json(catalog);
      if (path === `${MCP_CONTRACTS_PATH}/0.json`) return Response.json(contracts["0"]);
      throw new Error("Unexpected full-schema fetch");
    });
    const fallback = vi.fn(() => {
      throw new Error("Full schema must not load");
    });
    const source = createCatalogSource({ fetch }, "https://app.test", fallback);
    expect(fetch).not.toHaveBeenCalled();
    const index = await source.list();
    expect((await source.get(index[0])).operation).toEqual(canonical.paths["/api/v1/example"].post);
    await source.list();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fallback).not.toHaveBeenCalled();
  });

  it("keeps every canonical operation out of the execution code and tool descriptions", async () => {
    const server = new McpServer({ name: "test", version: "1" });
    const execute = vi.fn(async (_code: string) => ({ result: { ok: true } }));
    registerExecuteTools(server, { execute }, vi.fn());
    const client = new Client({ name: "test-client", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const tools = await client.listTools();
      expect(JSON.stringify(tools).length).toBeLessThan(6000);
      await client.callTool({ name: "execute", arguments: { code: "async () => 1" } });
      expect(execute).toHaveBeenCalledOnce();
      const code = execute.mock.calls[0];
      expect(code[0].length).toBeLessThan(500);
      expect(code[0]).not.toContain("__rawSpec");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("generates domain actions and subdomains without loading detailed contracts", async () => {
    const { catalog } = buildMcpCatalog(filterOpenApiSpecForMcp(openapi.schema));
    const domains = buildMcpDomains(catalog);
    const events = domains.find(({ name }) => name === "events")!;
    expect(events.actions).toEqual(expect.arrayContaining(["list", "get", "create", "update"]));
    expect(events.subdomains).toEqual(expect.arrayContaining(["agenda", "registrations", "forms"]));
    expect(domains.map(({ name }) => name)).toEqual(expect.arrayContaining(["events", "groups", "users"]));
    const request = vi.fn(async (options) => ({ ok: true, path: options.path }));
    const server = new McpServer({ name: "test", version: "1" });
    registerDomainTools(server, domains, request);
    const client = new Client({ name: "test", version: "1" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      const listed = (await client.listTools()).tools;
      const tool = listed.find(({ name }) => name === "events")!;
      expect(tool.description).toContain("Actions:");
      expect(tool.description).toContain("agenda");
      expect(tool.inputSchema.properties).not.toHaveProperty("operationId");
      expect(JSON.stringify(tool).length).toBeLessThan(4000);
      expect(JSON.stringify(listed).length).toBeLessThan(100000);
      await client.callTool({ name: "events", arguments: { action: "list", query: { limit: 5 } } });
      expect(request).toHaveBeenLastCalledWith({ method: "GET", path: "/api/v1/events", query: { limit: 5 } });
      await client.callTool({ name: "events", arguments: { action: "get", path: "/example/agenda" } });
      expect(request).toHaveBeenLastCalledWith({ method: "GET", path: "/api/v1/events/example/agenda" });
      for (const path of ["/../users", "/%2e%2e/users", "//outside.test", "/example?limit=100", "/example\\users"]) {
        const before = request.mock.calls.length;
        expect(await client.callTool({ name: "events", arguments: { action: "get", path } })).toMatchObject({
          isError: true,
        });
        expect(request).toHaveBeenCalledTimes(before);
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("derives a discovery index without carrying operation request or response schemas", () => {
    const spec = filterOpenApiSpecForMcp(openapi.schema);
    const { catalog, contracts } = buildMcpCatalog(spec);
    expect(catalog.length).toBe(Object.keys(contracts).length);
    for (const entry of catalog) {
      expect(entry).not.toHaveProperty("responses");
      expect(entry).not.toHaveProperty("requestBody");
      expect(contracts[entry.contract].operation).toEqual(spec.paths[entry.path][entry.method.toLowerCase()]);
    }
  });
});
