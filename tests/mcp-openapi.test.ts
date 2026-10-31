import { administratorGrants } from "./helpers/administrator";
import { describe, expect, it } from "vitest";
import { type AuthScope } from "../functions/_lib/auth/scopes";
import {
  AUTH_EXTENSION,
  decorateOpenApiSpec,
  filterOpenApiSpecForMcp,
  MCP_EXTENSION,
} from "../functions/_lib/openapi/mcp";
import type { AuthAdmin } from "../functions/_lib/types";
import {
  buildMcpOauthProps,
  grantedMcpOauthScopes,
  normalizeMcpOauthScopes,
  parseMcpOauthProps,
} from "../functions/_lib/auth/oauth/authorization";

const mcpWriteMetadata = {
  expose: true,
};

describe("MCP OpenAPI filtering", () => {
  it("discovers scoped JSON operations without a second opt-in and excludes binary or explicit exceptions", () => {
    const scoped = {
      [AUTH_EXTENSION]: { required: true, scopes: ["agenda:read"] },
      responses: { 200: { content: { "application/json": {} } } },
    };
    const spec = filterOpenApiSpecForMcp({
      paths: {
        "/scoped": {
          get: scoped,
          post: { ...scoped, [AUTH_EXTENSION]: { required: true, scopesAnyOf: [["agenda:write"]] } },
        },
        "/disabled": { get: { ...scoped, [MCP_EXTENSION]: { expose: false } } },
        "/binary": { get: { ...scoped, responses: { 200: { content: { "application/pdf": {} } } } } },
        "/upload": { put: { ...scoped, requestBody: { content: { "multipart/form-data": {} } } } },
        "/public": { get: { responses: scoped.responses } },
        "/browser-session": { get: { ...scoped, [AUTH_EXTENSION]: { required: true, scopes: [] } } },
      },
    });
    expect(Object.keys(spec.paths)).toEqual(["/scoped"]);
    expect(spec.paths["/scoped"].get.security).toEqual([{ McpSession: ["agenda:read"] }]);
    expect(spec.paths["/scoped"].post.security).toEqual([{ McpSession: ["agenda:write"] }]);
    expect(spec.paths["/scoped"].post[MCP_EXTENSION].readonly).toBe(false);
  });

  it("keeps explicitly exposed authenticated operations and adds bearer security", () => {
    const filtered = filterOpenApiSpecForMcp({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/events/{eventSlug}/proposals": {
          get: {
            operationId: "listProposals",
            [AUTH_EXTENSION]: { required: true, scopes: ["proposals:read"] },
            [MCP_EXTENSION]: { expose: true, readonly: true },
          },
        },
        "/api/v1/proposals/{proposalId}/decisions": {
          post: {
            operationId: "finalizeProposal",
          },
        },
        "/api/v1/proposals/{proposalId}/reviews": {
          get: {
            operationId: "listReviews",
          },
          post: {
            operationId: "upsertReview",
            [AUTH_EXTENSION]: { required: true, scopes: ["proposals:score"] },
            [MCP_EXTENSION]: mcpWriteMetadata,
          },
        },
      },
    });

    expect(Object.keys(filtered.paths)).toEqual([
      "/api/v1/events/{eventSlug}/proposals",
      "/api/v1/proposals/{proposalId}/reviews",
    ]);
    expect(filtered.paths["/api/v1/proposals/{proposalId}/decisions"]).toBeUndefined();
    expect(filtered.paths["/api/v1/proposals/{proposalId}/reviews"].post.security).toEqual([
      { McpSession: ["proposals:score"] },
    ]);
    expect(filtered.paths["/api/v1/events/{eventSlug}/proposals"].get.security).toEqual([
      { McpSession: ["proposals:read"] },
    ]);
    expect(filtered.components.securitySchemes.McpSession.scheme).toBe("bearer");
  });
});

describe("OpenAPI auth decoration", () => {
  it("marks explicitly authenticated resource operations and records required scopes", () => {
    const decorated = decorateOpenApiSpec({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/proposals/{proposalId}/reviews": {
          post: {
            operationId: "upsertReview",
            [AUTH_EXTENSION]: { required: true, scopes: ["proposals:score"] },
          },
        },
        "/api/v1/events/{eventSlug}/terms": {
          get: {
            operationId: "terms",
          },
        },
      },
    });

    const operation = decorated.paths["/api/v1/proposals/{proposalId}/reviews"].post;
    expect(operation.security).toEqual([{ BearerAuth: ["proposals:score"] }]);
    expect(operation[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["proposals:score"],
    });
    expect(operation["x-pkic-required-scopes"]).toEqual(["proposals:score"]);
    expect(operation.description).toContain("Required scopes: `proposals:score`.");
    expect(decorated.paths["/api/v1/events/{eventSlug}/terms"].get.security).toBeUndefined();
  });

  it("replaces stale required-scope text when MCP filtering narrows scopes", () => {
    const filtered = filterOpenApiSpecForMcp({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/proposals/{proposalId}/reviews": {
          post: {
            operationId: "upsertReview",
            description: "Existing operation summary.",
            [AUTH_EXTENSION]: {
              required: true,
              scheme: "BearerAuth",
              scopes: ["proposals:read", "proposals:score"],
            },
            [MCP_EXTENSION]: {
              expose: true,
              scopes: ["proposals:score"],
            },
          },
        },
      },
    });

    expect(filtered.paths["/api/v1/proposals/{proposalId}/reviews"].post.description).toBe(
      "Existing operation summary.\n\nRequired scopes: `proposals:score`.",
    );
  });

  it("preserves OR semantics for alternative MCP scopes", () => {
    const alternatives: AuthScope[][] = [["proposals:manage"], ["proposals:edit_accepted_abstract"]];
    const filtered = filterOpenApiSpecForMcp({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/proposals/{proposalId}": {
          patch: {
            operationId: "editProposal",
            [AUTH_EXTENSION]: { required: true, scopesAnyOf: alternatives },
            [MCP_EXTENSION]: { expose: true },
          },
        },
      },
    });
    const operation = filtered.paths["/api/v1/proposals/{proposalId}"].patch;

    expect(operation.security).toEqual(alternatives.map((scopes) => ({ McpSession: scopes })));
    expect(operation["x-pkic-required-scopes-any-of"]).toEqual(alternatives);
    expect(operation[MCP_EXTENSION].scopesAnyOf).toEqual(alternatives);
  });

  it("preserves explicit canonical operation scopes and leaves non-admin token workflows schema-documented", () => {
    const decorated = decorateOpenApiSpec({
      openapi: "3.1.0",
      info: { title: "PKI Consortium API", version: "v1" },
      paths: {
        "/api/v1/email/reminders/runs": {
          post: {
            operationId: "runReminders",
            [AUTH_EXTENSION]: { required: true, scopes: ["email:read", "email:manage"] },
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

    const operationsCommand = decorated.paths["/api/v1/email/reminders/runs"].post;
    expect(operationsCommand.security).toEqual([{ BearerAuth: ["email:read", "email:manage"] }]);
    expect(operationsCommand[AUTH_EXTENSION]).toEqual({
      required: true,
      scheme: "BearerAuth",
      scopes: ["email:read", "email:manage"],
    });

    const inviteOperation = decorated.paths["/api/v1/events/{eventSlug}/invites"].post;
    expect(inviteOperation.security).toBeUndefined();
    expect(inviteOperation[AUTH_EXTENSION]).toBeUndefined();
    expect(Object.keys(decorated.components.securitySchemes)).toEqual(["BearerAuth"]);
  });
});

describe("MCP scope delegation", () => {
  it("keeps service and user transports in representable, validated states", () => {
    const serviceActor: AuthAdmin = {
      identityType: "service",
      id: "api-key",
      email: "api-key",
      role: "admin",
    };
    expect(buildMcpOauthProps(serviceActor, ["admin:read"], "api-key")).toEqual({
      identityType: "service",
      id: "api-key",
      email: "api-key",
      role: "admin",
      scopes: ["admin:read"],
      authTransport: "api-key",
    });
    expect(() => buildMcpOauthProps(serviceActor, ["admin:read"], "bearer")).toThrowError(
      expect.objectContaining({ code: "MCP_AUTH_TRANSPORT_INVALID" }),
    );

    expect(() =>
      parseMcpOauthProps({
        identityType: "service",
        id: "api-key",
        email: "api-key",
        role: "admin",
        scopes: ["admin:read"],
        authTransport: "api-key",
        sessionId: "impossible-service-session",
      }),
    ).toThrowError(expect.objectContaining({ code: "MCP_AUTH_PROPS_INVALID" }));

    const userActor: AuthAdmin = {
      identityType: "user",
      id: "user-1",
      email: "user@example.test",
      grants: administratorGrants,
      sessionId: "session-1",
      oauthAuthorizationId: crypto.randomUUID(),
      expiresAt: "2099-01-01T00:00:00.000Z",
    };
    expect(buildMcpOauthProps(userActor, ["admin:read"], "oauth", "2098-12-31T23:00:00.000Z")).toMatchObject({
      identityType: "user",
      id: "user-1",
      authTransport: "oauth",
      sessionId: "session-1",
      sessionIdleExpiresAt: "2098-12-31T23:00:00.000Z",
    });
    const userProps = buildMcpOauthProps(userActor, ["admin:read"], "oauth", "2098-12-31T23:00:00.000Z");
    expect(() =>
      buildMcpOauthProps(
        { ...userActor, oauthAuthorizationId: undefined },
        ["admin:read"],
        "oauth",
        "2098-12-31T23:00:00.000Z",
      ),
    ).toThrowError(expect.objectContaining({ code: "MCP_AUTHORIZATION_REQUIRED" }));
    if (userProps.authTransport !== "oauth") throw new Error("Expected an OAuth grant");
    const { authorizationId: _ceiling, ...legacyProps } = userProps;
    expect(() => parseMcpOauthProps(legacyProps)).toThrowError(
      expect.objectContaining({ code: "MCP_AUTH_PROPS_INVALID" }),
    );
    expect(userProps).not.toHaveProperty("role");
    expect(() => buildMcpOauthProps(userActor, ["admin:read"], "oauth")).toThrowError(
      expect.objectContaining({ code: "MCP_AUTH_TRANSPORT_INVALID" }),
    );
    if (userProps.identityType !== "user") throw new Error("Expected a user-backed OAuth grant");
    const { sessionIdleExpiresAt: _idleDeadline, ...unboundedProps } = userProps;
    expect(() => parseMcpOauthProps(unboundedProps)).toThrowError(
      expect.objectContaining({ code: "MCP_AUTH_PROPS_INVALID" }),
    );
    expect(() => parseMcpOauthProps({ ...userProps, role: "admin" })).toThrowError(
      expect.objectContaining({ status: 401, code: "MCP_AUTH_PROPS_INVALID" }),
    );
    expect(() => buildMcpOauthProps(userActor, ["admin:read"], "api-key")).toThrowError(
      expect.objectContaining({ code: "MCP_AUTH_TRANSPORT_INVALID" }),
    );
  });

  it("does not turn an explicitly invalid scope list into full access", () => {
    expect(normalizeMcpOauthScopes(["not-a-real-permission"])).toEqual([]);
    expect(normalizeMcpOauthScopes([], ["proposals:read"])).toEqual(["proposals:read"]);
  });

  it("only grants scopes already held by a scoped actor", () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: "user-1",
      email: "reviewer@example.test",
      grants: [{ permission: "proposals:read", contextType: null, contextId: null }],
    };
    const requested: AuthScope[] = ["proposals:read", "proposals:score", "proposals:manage"];

    expect(grantedMcpOauthScopes(actor, requested)).toEqual(["proposals:read"]);
  });

  it("offers a permission held only within a resource without treating it as global", () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: "user-1",
      email: "reviewer@example.test",
      grants: [{ permission: "proposals:read", contextType: "event", contextId: crypto.randomUUID() }],
    };
    expect(grantedMcpOauthScopes(actor, ["proposals:read", "proposals:score"])).toEqual(["proposals:read"]);
  });
  it("delegates only the requested subset of current administrator grants", () => {
    const actor: AuthAdmin = {
      identityType: "user",
      id: "admin-1",
      email: "admin@example.test",
      grants: administratorGrants,
    };
    const requested: AuthScope[] = ["proposals:read", "proposals:score"];

    expect(grantedMcpOauthScopes(actor, requested)).toEqual(requested);
  });
});
