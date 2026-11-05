import type { McpCatalogEntry } from "./mcp-catalog";

/** HTTP transport aliases only. The canonical API still validates and authorizes each operation. */
export const MCP_DOMAIN_ACTIONS = {
  list: "GET",
  get: "GET",
  create: "POST",
  update: "PATCH",
  replace: "PUT",
  delete: "DELETE",
} as const;

export const MCP_GENERIC_TOOLS = ["discover_operations", "inspect_operation", "request", "execute", "batch_read"];

export interface McpDomainDescriptor {
  name: string;
  basePath: string;
  actions: (keyof typeof MCP_DOMAIN_ACTIONS)[];
  subdomains: string[];
}

/** Generate a compact domain index from exposed paths, without copying request schemas or permission policy. */
export function buildMcpDomains(catalog: readonly McpCatalogEntry[]): McpDomainDescriptor[] {
  const domains = new Map<string, { methods: Set<string>; subdomains: Set<string> }>();
  for (const entry of catalog) {
    const [name, ...segments] = entry.path.replace(/^\/api\/v1\//, "").split("/");
    if (!entry.path.startsWith("/api/v1/") || !/^[a-z][a-z0-9-]*$/.test(name)) continue;
    if (MCP_GENERIC_TOOLS.includes(name)) throw new Error(`API domain conflicts with an MCP helper: ${name}`);
    const domain = domains.get(name) ?? { methods: new Set<string>(), subdomains: new Set<string>() };
    domain.methods.add(entry.method);
    const subdomain = segments.find((segment) => segment && !segment.startsWith("{"));
    if (subdomain) domain.subdomains.add(subdomain);
    domains.set(name, domain);
  }
  return [...domains]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, domain]) => ({
      name,
      basePath: `/api/v1/${name}`,
      actions: (Object.keys(MCP_DOMAIN_ACTIONS) as McpDomainDescriptor["actions"]).filter((action) =>
        domain.methods.has(MCP_DOMAIN_ACTIONS[action]),
      ),
      subdomains: [...domain.subdomains].sort(),
    }));
}
