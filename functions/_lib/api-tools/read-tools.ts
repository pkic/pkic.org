import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestOptions } from "@cloudflare/codemode/mcp";
import { z } from "zod";

const readRequestSchema = z
  .object({
    path: z.string().min(1).max(500),
    query: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  })
  .strict();

/** Each read goes through the same adapter as execute, including API authorization. */
export function registerReadTools(server: McpServer, request: (options: RequestOptions) => Promise<unknown>): void {
  server.registerTool(
    "batch_read",
    {
      description:
        "Run up to 10 independent GET requests in parallel using the existing API. Results keep input order and contain each API result or transport failure. Every request is authorized by its API route. No retries, transaction, automatic pagination, or writes. Each response is limited to 2000 characters; narrow the API query for larger results. Follow each API's page.hasMore and limit/offset contract explicitly.",
      inputSchema: z.object({ requests: z.array(readRequestSchema).min(1).max(10) }),
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ requests }) => {
      const results = await Promise.allSettled(requests.map((options) => request({ method: "GET", ...options })));
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              results: results.map((result, index) => {
                if (result.status === "rejected") return { index, error: "API request failed; inspect with execute" };
                if ((JSON.stringify(result.value) ?? "").length > 2000) {
                  return { index, error: "Response exceeds batch limit; narrow the API query" };
                }
                return { index, result: result.value };
              }),
            }),
          },
        ],
      };
    },
  );
}
