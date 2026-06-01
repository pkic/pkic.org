import { DynamicWorkerExecutor, type Executor, type ExecuteResult } from "@cloudflare/codemode";
import { openApiMcpServer, type RequestOptions } from "@cloudflare/codemode/mcp";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { Hono } from "hono";
import { signAdminSessionToken } from "../auth/admin";
import { AUTH_SCOPES } from "../auth/scopes";
import { filterOpenApiSpecForMcp } from "../openapi/mcp";
import type { Env } from "../types";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_REGISTER_PATH,
  MCP_OAUTH_TOKEN_PATH,
  resolveMcpExternalToken,
  type McpOAuthEnv,
  type McpOAuthProps,
} from "./oauth";
import { createMcpAuthorizeHandler } from "./authorize";

export const MCP_PATH = "/api/v1/mcp";
export const MCP_OPENAPI_JSON_PATH = "/api/v1/mcp/openapi.json";

interface McpWorkerOptions {
  app: Hono<{ Bindings: Env }>;
  openApiSchema: Record<string, unknown>;
}

function ttlSeconds(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

class MissingWorkerLoaderExecutor implements Executor {
  async execute(): Promise<ExecuteResult> {
    return {
      result: null,
      error: "MCP code execution is unavailable because the LOADER binding is not configured.",
    };
  }
}

function mcpExecutor(env: Env): Executor {
  return env.LOADER ? new DynamicWorkerExecutor({ loader: env.LOADER }) : new MissingWorkerLoaderExecutor();
}

function apiRequestFromMcp(
  app: Hono<{ Bindings: Env }>,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  authorizationOverride?: string | null,
): (options: RequestOptions) => Promise<unknown> {
  const authorization = authorizationOverride ?? request.headers.get("authorization");

  return async ({ method, path, query, body, contentType, rawBody }) => {
    const url = new URL(path, request.url);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    const headers = new Headers({ accept: "application/json" });
    if (authorization) {
      headers.set("authorization", authorization);
    }

    let requestBody: BodyInit | undefined;
    if (body !== undefined && method !== "GET") {
      requestBody = rawBody && typeof body === "string" ? body : JSON.stringify(body);
      headers.set("content-type", contentType ?? "application/json");
    }

    const response = await app.fetch(new Request(url, { method, headers, body: requestBody }), env, ctx);
    const responseType = response.headers.get("content-type") ?? "";
    if (responseType.includes("application/json")) {
      return response.json();
    }

    return {
      status: response.status,
      body: await response.text(),
    };
  };
}

async function authorizationHeaderForMcp(
  request: Request,
  env: Env,
  oauthProps?: McpOAuthProps,
): Promise<string | null> {
  if (!oauthProps) {
    return request.headers.get("authorization");
  }

  if (oauthProps.authTransport === "api-key") {
    return request.headers.get("authorization");
  }

  if (!env.INTERNAL_SIGNING_SECRET || !oauthProps.sessionId || !oauthProps.sessionExpiresAt) {
    return null;
  }

  const token = await signAdminSessionToken(env.INTERNAL_SIGNING_SECRET, {
    admin: {
      id: oauthProps.adminId,
      email: oauthProps.email,
      role: oauthProps.role,
      scopes: oauthProps.scopes,
      sessionId: oauthProps.sessionId,
      expiresAt: oauthProps.sessionExpiresAt,
      state: oauthProps.state ?? null,
    },
    sessionId: oauthProps.sessionId,
    expiresAt: oauthProps.sessionExpiresAt,
    state: oauthProps.state ?? null,
    scopes: oauthProps.scopes,
  });

  return `Bearer ${token}`;
}

function createMcpResponse(options: McpWorkerOptions) {
  return async (request: Request, env: Env, ctx: ExecutionContext, oauthProps?: McpOAuthProps): Promise<Response> => {
    const authorization = await authorizationHeaderForMcp(request, env, oauthProps);
    const server = openApiMcpServer({
      spec: filterOpenApiSpecForMcp(options.openApiSchema),
      executor: mcpExecutor(env),
      request: apiRequestFromMcp(options.app, request, env, ctx, authorization),
      name: "pkic-api",
      version: "v1",
      description: "Search and call PKI Consortium API operations exposed for MCP.",
    });

    return createMcpHandler(server, { route: MCP_PATH })(request, env, ctx);
  };
}

export function createMcpWorkerFetch(
  options: McpWorkerOptions,
): (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response> {
  const mcpResponse = createMcpResponse(options);

  class McpApiHandler extends WorkerEntrypoint<McpOAuthEnv> {
    fetch(request: Request): Promise<Response> {
      return mcpResponse(request, this.env, this.ctx, this.ctx.props as McpOAuthProps | undefined);
    }
  }

  const mcpOauthDefaultHandler = createMcpAuthorizeHandler({ app: options.app });

  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    if (!env.OAUTH_KV) {
      return await options.app.fetch(request, env, ctx);
    }

    const oauthProvider = new OAuthProvider<McpOAuthEnv>({
      apiRoute: MCP_PATH,
      apiHandler: McpApiHandler,
      defaultHandler: mcpOauthDefaultHandler,
      authorizeEndpoint: MCP_OAUTH_AUTHORIZE_PATH,
      tokenEndpoint: MCP_OAUTH_TOKEN_PATH,
      clientRegistrationEndpoint: MCP_OAUTH_REGISTER_PATH,
      scopesSupported: [...AUTH_SCOPES],
      accessTokenTTL: ttlSeconds(env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS, 60 * 60),
      refreshTokenTTL: ttlSeconds(env.MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS, 8 * 60 * 60),
      allowPlainPKCE: false,
      clientIdMetadataDocumentEnabled: true,
      resolveExternalToken: resolveMcpExternalToken,
      resourceMetadata: {
        scopes_supported: [...AUTH_SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "PKI Consortium MCP",
      },
    });

    return await oauthProvider.fetch(request, env as McpOAuthEnv, ctx);
  };
}
