import { normalizeCode, type Executor } from "@cloudflare/codemode";
import type { RequestOptions } from "@cloudflare/codemode/mcp";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export const requestSchema = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
  path: z.string().min(1).max(500),
  query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  body: z.unknown().optional(),
  contentType: z.string().max(200).optional(),
  rawBody: z.boolean().optional(),
});

export function resultContent(result: unknown) {
  const text = JSON.stringify(result) ?? "null";
  if (text.length > 24_000) {
    return {
      isError: true,
      content: [
        {
          type: "text" as const,
          text: "Result exceeds tool output limit. Narrow the API query to return fewer records.",
        },
      ],
    };
  }
  return { content: [{ type: "text" as const, text }] };
}

/** Transport helpers only; the API owns request validation and authorization. */
export function registerExecuteTools(
  server: McpServer,
  executor: Executor,
  request: (options: RequestOptions) => Promise<unknown>,
): void {
  server.registerTool(
    "request",
    {
      description:
        'Call one existing API operation directly when its path and inputs are known; discovery and inspection are optional. Example: list events with {method: "GET", path: "/api/v1/events", query: {limit: 5}}. For unknown operations, discover with a narrow query and inspect only the missing contract details. Uses existing API validation and permissions. Narrow API queries to keep responses small.',
      inputSchema: requestSchema,
    },
    async (options) => resultContent(await request(options)),
  );

  server.registerTool(
    "execute",
    {
      description:
        "Run an async JavaScript arrow function. Available: codemode.request({method, path, query?, body?, contentType?, rawBody?}). Calls the existing API with its validation and permissions. No API schema is loaded into execution. Use discover_operations and inspect_operation for contracts. Return exactly one codemode.request(...) operation; dependent operations require separate calls. Narrow API queries; output is limited to 24000 characters. Example: async () => { const r = await codemode.request({method: 'GET', path: '/api/v1/groups', query: {limit: 5}}); return r; }",
      inputSchema: z.object({ code: z.string().min(1).max(32_000) }),
    },
    async ({ code }) => {
      try {
        const normalized = normalizeCode(code);
        const result = await executor.execute(
          `async () => {
const codemode = { request: async (options) => await __api.request(options) };
return await (${normalized})();
}`,
          [{ name: "__api", fns: { request: async (options: unknown) => request(requestSchema.parse(options)) } }],
        );
        if (result.error) return { isError: true, content: [{ type: "text" as const, text: result.error }] };
        return resultContent(result.result);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Execution failed" }],
        };
      }
    },
  );
}
