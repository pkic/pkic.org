import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  buildPageInfo,
  paginationQuerySchemaWithDefaults,
  searchQuerySchema,
} from "../../../assets/shared/schemas/pagination";

import type { McpCatalogSource } from "../openapi/mcp-catalog";

const methodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]);
const operationQuerySchema = paginationQuerySchemaWithDefaults({ limit: 5, maxLimit: 50 })
  .merge(searchQuerySchema)
  .extend({
    method: methodSchema.optional(),
    tag: z.string().min(1).max(100).optional(),
  });

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** Metadata only: these tools never resolve authority or implement a domain action. */
export function registerOperationTools(server: McpServer, source: McpCatalogSource): void {
  server.registerTool(
    "discover_operations",
    {
      description:
        "Find unknown API operations by text, HTTP method, or exact tag. Start with a narrow query and the default five results. Exact resource paths and shallow collections rank first. Returns method, path, and summary only. Skip discovery for known paths. Use inspect_operation only for missing contract details. The API evaluates effective permissions.",
      inputSchema: operationQuerySchema,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (query) => {
      const catalog = await source.list();
      const matches = catalog.filter(({ path, method, ...operation }) => {
        if (query.method && query.method !== method) return false;
        if (query.tag && !operation.tags?.some((tag) => tag.toLowerCase() === query.tag!.toLowerCase())) return false;
        return (
          !query.q ||
          [path, method, operation.operationId, operation.summary, ...(operation.tags ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(query.q.toLowerCase())
        );
      });
      const resource = query.q?.trim().toLowerCase();
      const rank = (path: string) =>
        path.toLowerCase() === resource || path.toLowerCase().endsWith(`/${resource}`) ? 0 : 1;
      matches.sort(
        (a, b) =>
          rank(a.path) - rank(b.path) ||
          a.path.split("/").length - b.path.split("/").length ||
          a.path.localeCompare(b.path) ||
          a.method.localeCompare(b.method),
      );
      const operations = matches
        .slice(query.offset, query.offset + query.limit)
        .map(({ method, path, summary }) => ({ method, path, summary }));
      return toolResult({
        operations,
        page: buildPageInfo(query.limit, query.offset, matches.length, operations.length),
      });
    },
  );

  server.registerTool(
    "inspect_operation",
    {
      description:
        "Read one operation's contract by exact path template and method. Defaults to request parameters and body only. Select response for one status code, or all for the full operation. Does not execute the API or evaluate current access.",
      inputSchema: z.object({
        path: z.string().min(1).max(500),
        method: methodSchema,
        section: z.enum(["request", "response", "all"]).default("request"),
        status: z
          .string()
          .regex(/^[1-5][0-9]{2}$/)
          .default("200"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ path, method, section, status }) => {
      const catalog = await source.list();
      const entry = catalog.find((candidate) => candidate.path === path && candidate.method === method);
      if (!entry) {
        return { ...toolResult({ error: "Operation not found", path, method }), isError: true };
      }
      const item = await source.get(entry);
      const contract = item.operation;
      const responses = contract.responses as Record<string, unknown> | undefined;
      const selected =
        section === "all"
          ? contract
          : section === "response"
            ? { response: responses?.[status], status }
            : { parameters: contract.parameters, requestBody: contract.requestBody, security: contract.security };
      return toolResult({ path, method, parameters: item.parameters, operation: selected });
    },
  );
}
