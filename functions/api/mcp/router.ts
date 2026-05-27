import { Hono } from "hono";
import { jsonNoStore } from "../../_lib/http";

type McpProfile = "all" | "events";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
}

interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

const eventTools: McpToolDefinition[] = [
  {
    name: "events.list",
    description: "List events the authenticated user can access.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "events.proposals.list",
    description: "List event proposals visible to the authenticated reviewer.",
    inputSchema: {
      type: "object",
      properties: {
        eventSlug: { type: "string" },
        status: { type: "string" },
        reviewStatus: { type: "string", enum: ["draft", "submitted"] },
      },
      required: ["eventSlug"],
    },
  },
  {
    name: "events.proposals.read",
    description: "Read one proposal, including abstract and review metadata.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
  },
  {
    name: "events.reviews.getMine",
    description: "Read the authenticated user's review or draft for a proposal.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
  },
  {
    name: "events.reviews.saveDraft",
    description: "Save a complete draft review for the authenticated reviewer.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        recommendation: { type: "string", enum: ["accept", "reject", "needs-work"] },
        score: { type: "integer", minimum: 1, maximum: 10 },
        reviewerComment: { type: "string" },
        applicantNote: { type: "string" },
      },
      required: ["proposalId", "recommendation", "score"],
    },
  },
  {
    name: "events.reviews.submit",
    description: "Submit a complete review as the authenticated reviewer.",
    inputSchema: {
      type: "object",
      properties: {
        proposalId: { type: "string" },
        recommendation: { type: "string", enum: ["accept", "reject", "needs-work"] },
        score: { type: "integer", minimum: 1, maximum: 10 },
        reviewerComment: { type: "string" },
        applicantNote: { type: "string" },
      },
      required: ["proposalId", "recommendation", "score"],
    },
  },
];

function toolsForProfile(profile: McpProfile): McpToolDefinition[] {
  if (profile === "events") {
    return eventTools;
  }
  return eventTools;
}

function discovery(profile: McpProfile): Record<string, unknown> {
  return {
    name: profile === "events" ? "PKI Consortium Events MCP" : "PKI Consortium MCP",
    profile,
    transport: "streamable-http",
    endpoints: {
      all: "/api/mcp",
      events: "/api/mcp/events",
    },
    capabilities: {
      tools: true,
    },
    tools: toolsForProfile(profile),
  };
}

function jsonRpcResult(request: JsonRpcRequest, result: unknown): Response {
  return jsonNoStore({ jsonrpc: "2.0", id: request.id ?? null, result });
}

function jsonRpcError(request: JsonRpcRequest, code: number, message: string): Response {
  return jsonNoStore({ jsonrpc: "2.0", id: request.id ?? null, error: { code, message } });
}

async function handleMcpPost(request: Request, profile: McpProfile): Promise<Response> {
  const body = (await request.json().catch(() => null)) as JsonRpcRequest | null;
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return jsonRpcError({ id: null }, -32600, "Invalid JSON-RPC request");
  }

  if (body.method === "initialize") {
    return jsonRpcResult(body, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: {
        name: profile === "events" ? "pkic-events" : "pkic",
        version: "0.1.0",
      },
    });
  }

  if (body.method === "tools/list") {
    return jsonRpcResult(body, { tools: toolsForProfile(profile) });
  }

  if (body.method === "tools/call") {
    return jsonRpcError(body, -32601, "MCP tool execution is not implemented yet");
  }

  return jsonRpcError(body, -32601, "Method not found");
}

const app = new Hono();

app.get("/", () => jsonNoStore(discovery("all")));
app.post("/", (c) => handleMcpPost(c.req.raw, "all"));
app.get("/events", () => jsonNoStore(discovery("events")));
app.post("/events", (c) => handleMcpPost(c.req.raw, "events"));

export default app;
