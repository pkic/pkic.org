import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestOptions } from "@cloudflare/codemode/mcp";
import { z } from "zod";
import { MCP_DOMAIN_ACTIONS, type McpDomainDescriptor } from "../openapi/mcp-domains";
import { requestSchema, resultContent } from "./execute-tools";

/** Domain selection is transport routing; all requests use the existing API adapter and its authorization. */
export function registerDomainTools(
  server: McpServer,
  domains: readonly McpDomainDescriptor[],
  request: (options: RequestOptions) => Promise<unknown>,
): void {
  for (const domain of domains) {
    server.registerTool(
      domain.name,
      {
        description: `Call the ${domain.name} API directly. Actions: ${domain.actions.join(", ")}. Subdomains: ${domain.subdomains.join(", ") || "none"}. path is relative to ${domain.basePath}; omit it for the collection. list/get=GET, create=POST, update=PATCH, replace=PUT, delete=DELETE. Actions vary by path; the API catalog and API permissions remain authoritative. Use inspect_operation only for unknown inputs. No detailed schemas are loaded here.`,
        inputSchema: requestSchema.omit({ method: true, path: true }).extend({
          action: z.enum(
            domain.actions as [McpDomainDescriptor["actions"][number], ...McpDomainDescriptor["actions"][number][]],
          ),
          path: z
            .string()
            .max(450)
            .default("")
            .describe(
              `Relative resource path, e.g. /{id} or /{id}/subdomain, with real identifiers. Empty selects ${domain.basePath}.`,
            ),
        }),
      },
      async ({ action, path, ...options }) => {
        if ((path && !path.startsWith("/")) || path.startsWith("//") || /[?#\\]/.test(path)) {
          return {
            isError: true,
            content: [{ type: "text", text: "Use a relative domain path and the query parameter object." }],
          };
        }
        const url = new URL(`${domain.basePath}${path}`, "https://api.invalid");
        if (url.pathname !== domain.basePath && !url.pathname.startsWith(`${domain.basePath}/`)) {
          return {
            isError: true,
            content: [{ type: "text", text: "The resource path must stay within this API domain." }],
          };
        }
        return resultContent(await request({ ...options, method: MCP_DOMAIN_ACTIONS[action], path: url.pathname }));
      },
    );
  }
}
