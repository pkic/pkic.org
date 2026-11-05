import { ResourceTemplate, type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode,
} from "@modelcontextprotocol/sdk/types.js";
import type { RequestOptions } from "@cloudflare/codemode/mcp";
import type { McpCatalogSource } from "../openapi/mcp-catalog";

const PAGE_SIZE = 20;

export function registerApiResources(
  server: McpServer,
  source: McpCatalogSource,
  request: (options: RequestOptions) => Promise<unknown>,
) {
  server.server.registerCapabilities({ resources: {} });
  server.server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [] }));
  server.server.setRequestHandler(ListResourceTemplatesRequestSchema, async ({ params }) => {
    const cursor = params?.cursor;
    if (cursor !== undefined && !/^(0|[1-9][0-9]*)$/u.test(cursor))
      throw new McpError(ErrorCode.InvalidParams, "Invalid resource template cursor");
    const offset = Number(cursor ?? 0);
    if (!Number.isSafeInteger(offset)) throw new McpError(ErrorCode.InvalidParams, "Invalid resource template cursor");
    const templates = await source.templates();
    return {
      resourceTemplates: templates.slice(offset, offset + PAGE_SIZE),
      ...(offset + PAGE_SIZE < templates.length ? { nextCursor: String(offset + PAGE_SIZE) } : {}),
    };
  });
  server.server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const uri = new URL(params.uri);
    if (uri.protocol !== "pkic:" || uri.host !== "api" || uri.username || uri.password || uri.hash)
      throw new McpError(ErrorCode.InvalidParams, "Choose a PKIC API resource URI");
    const templates = await source.templates();
    // Match the resource path independently: query variables are optional and order-independent.
    // The canonical API parser validates their values, defaults, and supported filters.
    const matched = templates.some(
      (template) =>
        new ResourceTemplate(template.uriTemplate.split("{?")[0], { list: undefined }).uriTemplate.match(
          `pkic://api${uri.pathname}`,
        ) !== null,
    );
    if (!matched) throw new McpError(-32002, "Resource not found");
    const result = await request({ method: "GET", path: uri.pathname + uri.search });
    const text = JSON.stringify(result) ?? "null";
    if (text.length > 24000)
      throw new McpError(ErrorCode.InvalidParams, "Resource exceeds MCP response limit; narrow the API query");
    return { contents: [{ uri: params.uri, mimeType: "application/json", text }] };
  });
}
