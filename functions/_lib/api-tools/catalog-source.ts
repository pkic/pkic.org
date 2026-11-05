import { MCP_RESOURCE_TEMPLATES_PATH, type ApiResourceTemplate } from "../openapi/mcp-resources";
import {
  buildMcpCatalog,
  MCP_CATALOG_PATH,
  MCP_CONTRACTS_PATH,
  type McpCatalogEntry,
  type McpCatalogSource,
  type McpContract,
} from "../openapi/mcp-catalog";
import type { StaticAssetsBinding } from "../types";

// Deployment metadata only. Cache completed values, never request I/O or authority.
const templates = new WeakMap<StaticAssetsBinding, ApiResourceTemplate[]>();
const catalogs = new WeakMap<StaticAssetsBinding, McpCatalogEntry[]>();

export function createCatalogSource(
  assets: StaticAssetsBinding | undefined,
  origin: string,
  fallback: () => ReturnType<typeof buildMcpCatalog>,
): McpCatalogSource {
  async function asset<T>(path: string): Promise<T | undefined> {
    if (!assets) return undefined;
    const response = await assets.fetch(new Request(new URL(path, origin)));
    return response.ok ? ((await response.json()) as T) : undefined;
  }
  return {
    async list() {
      const cached = assets && catalogs.get(assets);
      if (cached) return cached;
      const catalog = await asset<McpCatalogEntry[]>(MCP_CATALOG_PATH);
      if (!catalog) return fallback().catalog;
      if (assets) catalogs.set(assets, catalog);
      return catalog;
    },
    async templates() {
      const cached = assets && templates.get(assets);
      if (cached) return cached;
      const result = (await asset<ApiResourceTemplate[]>(MCP_RESOURCE_TEMPLATES_PATH)) ?? fallback().templates;
      if (assets) templates.set(assets, result);
      return result;
    },
    async get(entry) {
      const contract = await asset<McpContract>(`${MCP_CONTRACTS_PATH}/${entry.contract}.json`);
      if (contract) return contract;
      // Find by canonical path/method; generated numeric filenames are release-local.
      const local = fallback();
      const match = local.catalog.find(
        (candidate) => candidate.path === entry.path && candidate.method === entry.method,
      );
      if (!match) throw new Error("API operation contract not found");
      return local.contracts[match.contract];
    },
  };
}
