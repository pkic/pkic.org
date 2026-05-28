import type { McpProfile } from "./router";

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
    name: "events_list",
    description: "List events the authenticated user can access.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "events_proposals_list",
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
    name: "events_proposals_read",
    description: "Read one proposal, including abstract and review metadata.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
  },
  {
    name: "events_reviews_get_mine",
    description: "Read the authenticated user's review or draft for a proposal.",
    inputSchema: {
      type: "object",
      properties: { proposalId: { type: "string" } },
      required: ["proposalId"],
    },
  },
  {
    name: "events_reviews_save_draft",
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
    name: "events_reviews_submit",
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

export function toolsForProfile(profile: McpProfile): McpToolDefinition[] {
  if (profile === "events") {
    return eventTools;
  }
  return eventTools;
}

export function discovery(profile: McpProfile): Record<string, unknown> {
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
