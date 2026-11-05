import type { McpCatalogEntry, McpContract } from "./mcp-catalog";

export const MCP_RESOURCE_TEMPLATES_PATH = "/api/v1/mcp/resource-templates.json";
export interface ApiResourceTemplate {
  name: string;
  uriTemplate: string;
  description?: string;
  mimeType: "application/json";
}

/** Only transport metadata is derived here; API routes still validate and authorize reads. */
export function buildApiResourceTemplates(catalog: McpCatalogEntry[], contracts: Record<string, McpContract>) {
  return catalog
    .filter((entry) => entry.method === "GET")
    .flatMap((entry): ApiResourceTemplate[] => {
      const contract = contracts[entry.contract];
      if ((contract.operation["x-pkic-mcp"] as { readonly?: boolean } | undefined)?.readonly === false) return [];
      const responses = contract.operation.responses as
        | Record<string, { content?: Record<string, unknown> }>
        | undefined;
      if (
        !Object.entries(responses ?? {}).some(
          ([status, response]) => /^2/u.test(status) && response.content?.["application/json"],
        )
      )
        return [];
      const parameters = new Set<string>();
      for (const parameter of [
        ...(Array.isArray(contract.parameters) ? contract.parameters : []),
        ...(Array.isArray(contract.operation.parameters) ? contract.operation.parameters : []),
      ]) {
        if (parameter.in === "query" && typeof parameter.name === "string" && /^[A-Za-z0-9_]+$/u.test(parameter.name))
          parameters.add(parameter.name);
      }
      const query = [...parameters.keys()];
      return [
        {
          name: `GET ${entry.path}`,
          uriTemplate: `pkic://api${entry.path}${query.length ? `{?${query.join(",")}}` : ""}`,
          description: entry.summary,
          mimeType: "application/json",
        },
      ];
    })
    .sort((a, b) => a.name.split("/").length - b.name.split("/").length || a.name.localeCompare(b.name));
}
