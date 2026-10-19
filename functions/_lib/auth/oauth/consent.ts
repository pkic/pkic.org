import type { Hono } from "hono";
import type { Env } from "../../types";
import { MCP_AUTHORIZE_MAX_BYTES, readBoundedFormData, readBoundedJsonBody } from "../../http-body";
import { requireInternalSecret } from "../../request";
import { assertSameOriginRequest } from "../../request-origin";
import { approveOauthAuthorization } from "../../services/oauth-authorizations/approval";
import { processOauthAuthorizationCompletionBackground } from "../../services/oauth-authorizations/completion";
import { oauthAuthorizationApprovalResponseSchema } from "../../../../assets/shared/schemas/oauth-authorizations";
import { jsonNoStore as jsonResponse } from "../../http";
import { AppError, isAppError } from "../../errors";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  describeMcpAuthorization,
  parseOauthRequestFromReturnTo,
  redirectToMcpOauthUi,
  redirectAuthorizationDenied,
  resolveMcpOauthSession,
  resolveAuthorizeReturnTo,
  sanitizeAuthorizeReturnTo,
  sendMcpAuthorizeMagicLink,
  toOAuthErrorResponse,
  type McpOAuthEnv,
  wantsJsonResponse,
} from "./authorization";
import {
  mcpOauthAuthorizeActionSchema,
  mcpOauthContextSchema,
  mcpOauthMagicLinkResponseSchema,
  mcpOauthRedirectResponseSchema,
} from "../../../../assets/shared/schemas/mcp-oauth";

interface McpAuthorizeHandlerOptions {
  app: Hono<{ Bindings: Env }>;
}

async function parseAuthorizePayload(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  let raw: unknown;
  if (contentType.includes("application/json")) {
    try {
      raw = await readBoundedJsonBody(request, MCP_AUTHORIZE_MAX_BYTES);
    } catch (error) {
      if (isAppError(error) && error.code === "REQUEST_BODY_TOO_LARGE") throw error;
      raw = {};
    }
  } else {
    const form = await readBoundedFormData(request, MCP_AUTHORIZE_MAX_BYTES);
    raw = {
      action: form.get("action"),
      email: form.get("email"),
      return_to: form.get("return_to"),
      scopes: form.getAll("scopes"),
      actingIdentityId: form.get("actingIdentityId") || null,
    };
  }
  const parsed = mcpOauthAuthorizeActionSchema.safeParse(raw);
  if (!parsed.success)
    throw new AppError(400, "VALIDATION_ERROR", "Invalid OAuth authorization request", parsed.error.flatten());
  return { ...parsed.data, returnTo: sanitizeAuthorizeReturnTo(parsed.data.return_to) };
}

async function handleAuthorizeGet(request: Request, env: McpOAuthEnv): Promise<Response> {
  const returnTo = resolveAuthorizeReturnTo(request);
  if (!wantsJsonResponse(request)) {
    return redirectToMcpOauthUi(env, request, returnTo);
  }

  return jsonResponse(mcpOauthContextSchema.parse(await describeMcpAuthorization(request, env, returnTo)));
}

async function handleMagicLinkRequest(
  request: Request,
  env: McpOAuthEnv,
  ctx: ExecutionContext,
  email: string,
  returnTo: string,
): Promise<Response> {
  await sendMcpAuthorizeMagicLink({ request, env, executionCtx: ctx, email, returnTo });
  return jsonResponse(mcpOauthMagicLinkResponseSchema.parse({ success: true, sentTo: email || null }));
}

async function handleAuthorizeApproval(
  request: Request,
  env: McpOAuthEnv,
  ctx: ExecutionContext,
  returnTo: string,
  selectedScopes: unknown,
  expectedActingIdentityId: string | null,
) {
  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const session = await resolveMcpOauthSession(request, env);
  if (!session?.staff || !session.staffIdleExpiresAt)
    throw new AppError(401, "AUTH_EXPIRED", "Your authorization session expired. Sign in again.");
  if (session.actingIdentities.length > 1 && !session.actingIdentityId)
    throw new AppError(
      409,
      "ACTING_IDENTITY_REQUIRED",
      "Choose the identity you act as before authorizing this client",
    );
  const client = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const result = await approveOauthAuthorization(env.DB, {
    request: authRequest,
    actor: session.staff,
    member: session.member ?? null,
    staffIdleExpiresAt: session.staffIdleExpiresAt,
    clientName: client?.clientName ?? authRequest.clientId,
    selectedScopes,
    actingIdentityId: session.actingIdentityId,
    expectedActingIdentityId,
    signingSecret: requireInternalSecret(env),
  });
  ctx.waitUntil(processOauthAuthorizationCompletionBackground(env, result.authorizationId, env.OAUTH_PROVIDER));
  return oauthAuthorizationApprovalResponseSchema.parse(result);
}

async function handleAuthorizePost(request: Request, env: McpOAuthEnv, ctx: ExecutionContext): Promise<Response> {
  assertSameOriginRequest(request, new URL(request.url).origin, "oauth_authorization");
  const payload = await parseAuthorizePayload(request);
  const { action, returnTo } = payload;

  if (action === "request-link") {
    return handleMagicLinkRequest(request, env, ctx, payload.email, returnTo);
  }

  if (action === "deny") {
    const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
    const response = redirectAuthorizationDenied(authRequest);
    return jsonResponse(mcpOauthRedirectResponseSchema.parse({ redirectTo: response.headers.get("location") }), 200);
  }

  if (action === "approve") {
    return jsonResponse(
      await handleAuthorizeApproval(request, env, ctx, returnTo, payload.scopes, payload.actingIdentityId),
      202,
    );
  }

  return new Response("Method not allowed", { status: 405 });
}

async function handleAuthorize(request: Request, env: McpOAuthEnv, ctx: ExecutionContext): Promise<Response> {
  try {
    if (request.method === "GET") {
      return await handleAuthorizeGet(request, env);
    }

    if (request.method === "POST") {
      return await handleAuthorizePost(request, env, ctx);
    }

    return new Response("Method not allowed", { status: 405 });
  } catch (error) {
    return toOAuthErrorResponse(error);
  }
}

export function createMcpAuthorizeHandler(options: McpAuthorizeHandlerOptions) {
  return {
    async fetch(request: Request, env: McpOAuthEnv, ctx: ExecutionContext): Promise<Response> {
      const url = new URL(request.url);

      if (url.pathname === MCP_OAUTH_AUTHORIZE_PATH) {
        return await handleAuthorize(request, env, ctx);
      }

      return await options.app.fetch(request, env, ctx);
    },
  };
}
