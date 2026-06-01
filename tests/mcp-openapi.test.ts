import { describe, expect, it } from "vitest";
import { grantableScopesForActor, type AuthScope } from "../functions/_lib/auth/scopes";
import {
  AUTH_EXTENSION,
  decorateOpenApiSpec,
  filterOpenApiSpecForMcp,
  MCP_EXTENSION,
} from "../functions/_lib/openapi/mcp";
import type { AuthAdmin } from "../functions/_lib/types";

const mcpWriteMetadata = {
  expose: true,
};

describe("MCP OpenAPI filtering", () => {
  it("keeps authenticated read operations by default and adds bearer security", () => {
    const filtered = filterOpenApiSpecForMcp({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/admin/events/{eventSlug}/proposals": {
          get: {
            operationId: "listProposals",
          },
        },
        "/api/v1/admin/proposals/{proposalId}/finalize": {
          post: {
            operationId: "finalizeProposal",
          },
        },
        "/api/v1/admin/proposals/{proposalId}/reviews": {
          get: {
            operationId: "listReviews",
          },
          post: {
            operationId: "upsertReview",
            [MCP_EXTENSION]: mcpWriteMetadata,
          },
        },
      },
    });

    expect(Object.keys(filtered.paths)).toEqual([
      "/api/v1/admin/events/{eventSlug}/proposals",
      "/api/v1/admin/proposals/{proposalId}/reviews",
    ]);
    expect(filtered.paths["/api/v1/admin/proposals/{proposalId}/finalize"]).toBeUndefined();
    expect(filtered.paths["/api/v1/admin/proposals/{proposalId}/reviews"].post.security).toEqual([
      { McpSession: ["proposal-reviews:write"] },
    ]);
    expect(filtered.paths["/api/v1/admin/events/{eventSlug}/proposals"].get.security).toEqual([
      { McpSession: ["proposals:read", "events:read"] },
    ]);
    expect(filtered.components.securitySchemes.McpSession.scheme).toBe("bearer");
  });
});

describe("OpenAPI auth decoration", () => {
  it("marks authenticated admin operations and records required scopes", () => {
    const decorated = decorateOpenApiSpec({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/admin/proposals/{proposalId}/reviews": {
          post: {
            operationId: "upsertReview",
          },
        },
        "/api/v1/events/{eventSlug}/terms": {
          get: {
            operationId: "terms",
          },
        },
      },
    });

    const operation = decorated.paths["/api/v1/admin/proposals/{proposalId}/reviews"].post;
    expect(operation.security).toEqual([{ BearerAuth: ["proposal-reviews:write"] }]);
    expect(operation[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["proposal-reviews:write"],
    });
    expect(operation["x-pkic-required-scopes"]).toEqual(["proposal-reviews:write"]);
    expect(operation.description).toContain("Required scopes: `proposal-reviews:write`.");
    expect(decorated.paths["/api/v1/events/{eventSlug}/terms"].get.security).toBeUndefined();
  });

  it("replaces stale required-scope text when MCP filtering narrows scopes", () => {
    const filtered = filterOpenApiSpecForMcp({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/admin/proposals/{proposalId}/reviews": {
          post: {
            operationId: "upsertReview",
            description: "Existing operation summary.",
            [AUTH_EXTENSION]: {
              required: true,
              scheme: "BearerAuth",
              scopes: ["proposal-reviews:read", "proposal-reviews:write"],
            },
            [MCP_EXTENSION]: {
              expose: true,
              scopes: ["proposal-reviews:write"],
            },
          },
        },
      },
    });

    expect(filtered.paths["/api/v1/admin/proposals/{proposalId}/reviews"].post.description).toBe(
      "Existing operation summary.\n\nRequired scopes: `proposal-reviews:write`.",
    );
  });

  it("marks internal admin routes and leaves non-admin token workflows as schema-documented inputs", () => {
    const decorated = decorateOpenApiSpec({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/internal/email/retry": {
          post: {
            operationId: "retryEmail",
          },
        },
        "/api/v1/events/{eventSlug}/invites": {
          post: {
            operationId: "createInvite",
            responses: {
              "200": { description: "Invites created." },
              "401": { description: "Registration manage token required." },
            },
          },
        },
      },
    });

    const internalOperation = decorated.paths["/api/v1/internal/email/retry"].post;
    expect(internalOperation.security).toEqual([{ BearerAuth: ["admin:read"] }]);
    expect(internalOperation[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["admin:read"],
    });

    const inviteOperation = decorated.paths["/api/v1/events/{eventSlug}/invites"].post;
    expect(inviteOperation.security).toBeUndefined();
    expect(inviteOperation[AUTH_EXTENSION]).toBeUndefined();
    expect(Object.keys(decorated.components.securitySchemes)).toEqual(["BearerAuth"]);
  });
});

describe("MCP scope delegation", () => {
  it("only grants scopes already held by a scoped actor", () => {
    const actor: AuthAdmin = {
      id: "user-1",
      email: "reviewer@example.test",
      role: "admin",
      scopes: ["proposals:read", "proposal-reviews:read"],
    };
    const requested: AuthScope[] = ["proposals:read", "proposal-reviews:write", "proposal-finalization:write"];

    expect(grantableScopesForActor(actor, requested)).toEqual(["proposals:read"]);
  });

  it("treats current unscoped admins as fully delegable until admin sessions are scoped", () => {
    const actor: AuthAdmin = {
      id: "admin-1",
      email: "admin@example.test",
      role: "admin",
    };
    const requested: AuthScope[] = ["proposals:read", "proposal-reviews:write"];

    expect(grantableScopesForActor(actor, requested)).toEqual(requested);
  });
});
