import { buildApiResourceTemplates, type ApiResourceTemplate } from "./mcp-resources.ts";
import { MCP_HTTP_METHODS } from "./mcp.ts";

export const MCP_CATALOG_PATH = "/api/v1/mcp/operations.json";
export const MCP_CONTRACTS_PATH = "/api/v1/mcp/contracts";

export interface McpCatalogEntry {
  path: string;
  method: string;
  contract: string;
  operationId?: string;
  summary?: string;
  tags?: string[];
  security?: unknown;
}

export interface McpContract {
  parameters?: unknown;
  operation: Record<string, unknown>;
}

export interface McpCatalogSource {
  list(): Promise<McpCatalogEntry[]>;
  templates(): Promise<ApiResourceTemplate[]>;
  get(entry: McpCatalogEntry): Promise<McpContract>;
}

/** Derived build artifacts, never a second API contract or authorization policy. */
export function buildMcpCatalog(spec: { paths?: unknown }) {
  const catalog: McpCatalogEntry[] = [];
  const contracts: Record<string, McpContract> = {};
  for (const [path, item] of Object.entries((spec.paths ?? {}) as Record<string, Record<string, unknown>>)) {
    for (const [method, value] of Object.entries(item)) {
      if (!MCP_HTTP_METHODS.has(method) || !value || typeof value !== "object") continue;
      const operation = value as Record<string, unknown>;
      const contract = String(catalog.length);
      catalog.push({
        path,
        method: method.toUpperCase(),
        contract,
        operationId: operation.operationId as string | undefined,
        summary: operation.summary as string | undefined,
        tags: operation.tags as string[] | undefined,
        security: operation.security,
      });
      contracts[contract] = { parameters: item.parameters, operation };
    }
  }
  return { catalog, contracts, templates: buildApiResourceTemplates(catalog, contracts) };
}
