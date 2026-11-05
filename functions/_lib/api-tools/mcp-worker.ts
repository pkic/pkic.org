import { registerApiResources } from "./resource-templates";
import { withPreparedRequestAdmin } from "../auth/admin";
import { readBoundedStream } from "../utils/bounded-stream";
import { singleOperationExecutor } from "./single-operation-executor";
import { prepareMcpRequestAuthorization } from "./request-authorization";
import { CallToolRequestSchema, ReadResourceRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { AppError } from "../errors";
import { DynamicWorkerExecutor, type Executor, type ExecuteResult } from "@cloudflare/codemode";
import type { RequestOptions } from "@cloudflare/codemode/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CfWorkerJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/cfworker";
import { registerOperationTools } from "./operation-tools";
import { registerExecuteTools } from "./execute-tools";
import { registerDomainTools } from "./domain-tools";
import { buildMcpDomains, MCP_GENERIC_TOOLS } from "../openapi/mcp-domains";
import { registerReadTools } from "./read-tools";
import type { McpCatalogSource } from "../openapi/mcp-catalog";
import OAuthProvider from "@cloudflare/workers-oauth-provider";
import { createMcpHandler } from "agents/mcp";
import { WorkerEntrypoint } from "cloudflare:workers";
import type { Hono } from "hono";
import type { Env } from "../types";
import { resolveAppBaseUrl } from "../config";
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
  getOperationSource: (request: Request, env: Env) => McpCatalogSource;
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
  source: McpCatalogSource,
  onRequest: (finish: () => Promise<void>) => void,
): (options: RequestOptions) => Promise<unknown> {
  const authorization = authorizationOverride ?? request.headers.get("authorization");

  return async ({ method, path, query, body, contentType, rawBody }) => {
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#"))
      throw new AppError(400, "MCP_OPERATION_UNAVAILABLE", "Choose an exposed API operation with a relative API path.");
    const url = new URL(path, request.url);
    if (
      url.origin !== new URL(request.url).origin ||
      !(await source.list()).some(({ path: template, method: operationMethod }) => {
        const pattern = template
          .split(/(\{[^}]+\})/u)
          .map((part) => (part.startsWith("{") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")))
          .join("");
        return operationMethod === method && new RegExp(`^${pattern}$`, "u").test(url.pathname);
      })
    )
      throw new AppError(400, "MCP_OPERATION_UNAVAILABLE", "Choose an exposed API operation from discover_operations.");
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
    if (responseType && !/json|xml|^text\//i.test(responseType)) {
      await response.body?.cancel();
      return {
        status: response.status,
        contentType: responseType,
        error: "This response type requires a binary-capable API client",
      };
    }
    const result = await readBoundedStream(response.body, 2 * 1024 * 1024);
    if (!result.ok) {
      return { status: response.status, error: "API response exceeds MCP transport limit; narrow the API query" };
    }
    const text = new TextDecoder().decode(result.bytes);
    if (responseType.includes("application/json")) {
      return JSON.parse(text);
    }

    return {
      status: response.status,
      body: text,
    };
  };
}

function createMcpResponse(options: McpWorkerOptions) {
  return async (request: Request, env: Env, ctx: ExecutionContext, oauthProps?: McpOAuthProps): Promise<Response> => {
    const message =
      request.method === "POST"
        ? await request
            .clone()
            .json()
            .catch(() => null)
        : null;
    const rpc = CallToolRequestSchema.safeParse(message);
    const source = options.getOperationSource(request, env);
    const domainCall = rpc.success && !MCP_GENERIC_TOOLS.includes(rpc.data.params.name);
    const execution =
      ReadResourceRequestSchema.safeParse(message).success ||
      Boolean(rpc.success && (["execute", "request", "batch_read"].includes(rpc.data.params.name) || domainCall));
    const authorization = await (execution ? deferredAuthorizationHeaderForMcp : authorizationHeaderForMcp)(
      request,
      env,
      oauthProps,
    );
    const listing =
      message !== null && typeof message === "object" && "method" in message && message.method === "tools/list";
    const domains = listing || domainCall ? buildMcpDomains(await source.list()) : [];
    const finishers: Array<() => Promise<void>> = [];
    const apiRequest = apiRequestFromMcp(options.app, request, env, ctx, authorization, source, (value) => {
      finishers.push(value);
    });
    const server = new McpServer(
      { name: "pkic-api", version: "v1" },
      { jsonSchemaValidator: new CfWorkerJsonSchemaValidator() },
    );
    registerApiResources(server, source, apiRequest);
    registerOperationTools(server, source);
    registerExecuteTools(server, singleOperationExecutor(mcpExecutor(env)), apiRequest);
    registerReadTools(server, apiRequest);
    registerDomainTools(server, domains, apiRequest);

    const response = await createMcpHandler(server, { route: MCP_PATH })(request, env, ctx);
    if (execution) {
      // Tool responses are finite SSE streams. Complete authorization before releasing a result or challenge.
      const body = await readBoundedStream(
        response.body,
        MCP_TOOL_RESPONSE_MAX_BYTES,
        "MCP tool result is too large",
        request.signal,
      );
      if (finishers.length) {
        for (const finish of finishers) await finish();
      } else await authorizationHeaderForMcp(request, env, oauthProps);
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
      ...mcpOauthProviderSettings(env, resolveAppBaseUrl(env, request)),
      apiRoute: MCP_PATH,
      apiHandler: McpApiHandler,
      defaultHandler: mcpOauthDefaultHandler,
      resolveExternalToken: resolveMcpExternalToken,
    });

    return await oauthProvider.fetch(request, env as McpOAuthEnv, ctx);
  };
}
