import { withPreparedRequestAdmin } from "../auth/admin";
import { readBoundedStream } from "../utils/bounded-stream";
import { singleOperationExecutor } from "./single-operation-executor";
import { prepareMcpRequestAuthorization } from "./request-authorization";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "../errors";
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
import {
  authorizationHeaderForMcp,
  deferredAuthorizationHeaderForMcp,
  mcpAuthenticationError,
} from "../auth/oauth/session-authorization";

import { MCP_PATH } from "../auth/oauth/policy";
import { mcpOauthProviderSettings } from "../auth/oauth/provider-settings";
export { MCP_PATH } from "../auth/oauth/policy";
export const MCP_OPENAPI_JSON_PATH = "/api/v1/mcp/openapi.json";
// The SDK truncates tool results; retain bounded UTF-8 headroom while checking the completed finite stream.
const MCP_TOOL_RESPONSE_MAX_BYTES = 256 * 1024;

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
  authorizationOverride: string | null | undefined,
  spec: Record<string, unknown>,
  onRequest: (finish: () => Promise<void>) => void,
): (options: RequestOptions) => Promise<unknown> {
  const authorization = authorizationOverride ?? request.headers.get("authorization");

  return async ({ method, path, query, body, contentType, rawBody }) => {
    const url = new URL(path, request.url);
    if (
      url.origin !== new URL(request.url).origin ||
      !Object.entries(spec.paths && typeof spec.paths === "object" ? spec.paths : {}).some(([template, methods]) => {
        const pattern = template
          .split(/(\{[^}]+\})/u)
          .map((part) => (part.startsWith("{") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
          .join("");
        return (
          Boolean(
            methods && typeof methods === "object" && (methods as Record<string, unknown>)[method.toLowerCase()],
          ) && new RegExp(`^${pattern}$`, "u").test(url.pathname)
        );
      })
    )
      throw new AppError(400, "MCP_OPERATION_UNAVAILABLE", "Choose an exposed API operation from search.");
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

    const apiRequest = new Request(url, { method, headers, body: requestBody });
    const authority = await prepareMcpRequestAuthorization(env.DB, apiRequest, env);
    onRequest(authority.finish);
    const apiEnvironment = { ...env, DB: authority.db } as Env;
    const response = await app.fetch(
      apiRequest,
      authority.actor ? withPreparedRequestAdmin(apiEnvironment, apiRequest, authority.actor) : apiEnvironment,
      ctx,
    );
    await authority.finish();
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
    const rpc =
      request.method === "POST"
        ? CallToolRequestSchema.safeParse(
            await request
              .clone()
              .json()
              .catch(() => null),
          )
        : null;
    const execution = Boolean(rpc?.success && rpc.data.params.name === "execute");
    const authorization = await (execution ? deferredAuthorizationHeaderForMcp : authorizationHeaderForMcp)(
      request,
      env,
      oauthProps,
    );
    const spec = await options.getMcpOpenApiSchema(request, env);
    let finish: (() => Promise<void>) | undefined;
    const server = openApiMcpServer({
      spec,
      executor: singleOperationExecutor(mcpExecutor(env)),
      request: apiRequestFromMcp(options.app, request, env, ctx, authorization, spec, (value) => {
        finish = value;
      }),
      name: "pkic-api",
      version: "v1",
      description:
        "Return exactly one codemode.request(...) operation per execute call. Use separate execute calls for dependent operations. Search and call PKI Consortium API operations exposed for MCP.",
    });

    const response = await createMcpHandler(server, { route: MCP_PATH })(request, env, ctx);
    if (execution) {
      // Tool responses are finite SSE streams. Complete authorization before releasing a result or challenge.
      const body = await readBoundedStream(
        response.body,
        MCP_TOOL_RESPONSE_MAX_BYTES,
        "MCP tool result is too large",
        request.signal,
      );
      if (finish) await finish();
      else await authorizationHeaderForMcp(request, env, oauthProps);
      if (!body.ok) throw new AppError(413, "MCP_TOOL_RESULT_TOO_LARGE", "Return a smaller API result.");
      return new Response(new Uint8Array(body.bytes).buffer, response);
    }
    return response;
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
