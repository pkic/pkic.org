import { DynamicWorkerExecutor, type Executor, type ExecuteResult } from "@cloudflare/codemode";
import { openApiMcpServer, type RequestOptions } from "@cloudflare/codemode/mcp";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { Hono } from "hono";
import { AUTH_SCOPES } from "../auth/scopes";
import type { Env } from "../types";
import {
  parseMcpOauthProps,
  resolveMcpExternalToken,
  toOAuthErrorResponse,
  type McpOAuthEnv,
  type McpOAuthProps,
} from "../auth/oauth/authorization";
import { createMcpAuthorizeHandler } from "../auth/oauth/consent";
import { authorizationHeaderForMcp, mcpAuthenticationError } from "../auth/oauth/session-authorization";

import { MCP_PATH } from "../auth/oauth/policy";
import { mcpOauthProviderSettings } from "../auth/oauth/provider-settings";
export { MCP_PATH } from "../auth/oauth/policy";
export const MCP_OPENAPI_JSON_PATH = "/api/v1/mcp/openapi.json";

interface McpWorkerOptions {
  app: Hono<{ Bindings: Env }>;
  getMcpOpenApiSchema: (request: Request, env: Env) => Promise<Record<string, unknown>>;
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
      headers.set("x-pkic-machine-auth", "mcp");
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

function createMcpResponse(options: McpWorkerOptions) {
  return async (request: Request, env: Env, ctx: ExecutionContext, oauthProps?: McpOAuthProps): Promise<Response> => {
    const authorization = await authorizationHeaderForMcp(request, env, oauthProps);
    const server = openApiMcpServer({
      spec: await options.getMcpOpenApiSchema(request, env),
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
    async fetch(request: Request): Promise<Response> {
      try {
        return await mcpResponse(request, this.env, this.ctx, parseMcpOauthProps(this.ctx.props));
      } catch (error) {
        return mcpAuthenticationError(request, error) ?? toOAuthErrorResponse(error);
      }
    }
  }

  const mcpOauthDefaultHandler = createMcpAuthorizeHandler({ app: options.app });

  return async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    if (!env.OAUTH_KV) {
      return await options.app.fetch(request, env, ctx);
    }

    const oauthProvider = new OAuthProvider<McpOAuthEnv>({
      ...mcpOauthProviderSettings(env),
      apiRoute: MCP_PATH,
      apiHandler: McpApiHandler,
      defaultHandler: mcpOauthDefaultHandler,
      resolveExternalToken: resolveMcpExternalToken,
      resourceMetadata: {
        resource: new URL(MCP_PATH, request.url).toString(),
        scopes_supported: [...AUTH_SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "PKI Consortium MCP",
      },
    });

    return await oauthProvider.fetch(request, env as McpOAuthEnv, ctx);
  };
}
