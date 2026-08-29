import type { Hono } from "hono";
import type { Env } from "../types";
import { MCP_AUTHORIZE_MAX_BYTES, readBoundedFormData, readBoundedJsonBody } from "../http-body";
import { AppError, isAppError } from "../errors";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  buildMcpOauthProps,
  describeMcpAuthorization,
  grantedMcpOauthScopes,
  normalizeMcpOauthScopes,
  parseOauthRequestFromReturnTo,
  redirectToMcpOauthUi,
  redirectAuthorizationDenied,
  requireMcpOauthAdmin,
  resolveAuthorizeReturnTo,
  sanitizeAuthorizeReturnTo,
  sendMcpAuthorizeMagicLink,
  toOAuthErrorResponse,
  type McpOAuthEnv,
  wantsJsonResponse,
} from "./oauth";
import {
  mcpOauthAuthorizeActionSchema,
  mcpOauthContextSchema,
  mcpOauthMagicLinkResponseSchema,
  mcpOauthRedirectResponseSchema,
} from "../../../assets/shared/schemas/mcp-oauth";

interface McpAuthorizeHandlerOptions {
  app: Hono<{ Bindings: Env }>;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

async function parseAuthorizePayload(
  request: Request,
): Promise<{ action: "request-link" | "approve" | "deny"; email: string; returnTo: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  let raw: { action: unknown; email?: unknown; return_to: unknown };
  if (contentType.includes("application/json")) {
    let parsed: unknown;
    try {
      parsed = await readBoundedJsonBody(request, MCP_AUTHORIZE_MAX_BYTES);
    } catch (error) {
      if (isAppError(error) && error.code === "REQUEST_BODY_TOO_LARGE") {
        throw error;
      }
      parsed = {};
    }
    const body = parsed as {
      action?: unknown;
      email?: unknown;
      return_to?: unknown;
    };

    raw = {
      action: String(body.action ?? ""),
      email: String(body.email ?? "").trim(),
      return_to: typeof body.return_to === "string" ? body.return_to : "",
    };
  } else {
    const formData = await readBoundedFormData(request, MCP_AUTHORIZE_MAX_BYTES);
    raw = {
      action: String(formData.get("action") ?? ""),
      email: String(formData.get("email") ?? "").trim(),
      return_to: formData.get("return_to")?.toString() ?? "",
    };
  }

  const parsed = mcpOauthAuthorizeActionSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid OAuth authorization request", parsed.error.flatten());
  }
  return {
    action: parsed.data.action,
    email: parsed.data.action === "request-link" ? parsed.data.email : "",
    returnTo: sanitizeAuthorizeReturnTo(parsed.data.return_to),
  };
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
  returnTo: string,
): Promise<{ redirectTo: string }> {
  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const admin = await requireMcpOauthAdmin(request, env);
  if (!admin) {
    throw new Error("Your authorization session expired. Request a new sign-in link.");
  }

  const requestedScopes = normalizeMcpOauthScopes(authRequest.scope);
  const grantedScopes = grantedMcpOauthScopes(admin, requestedScopes);
  if (grantedScopes.length === 0) {
    throw new Error("No scopes can be granted for this request.");
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: authRequest,
    userId: admin.id,
    metadata: {
      email: admin.email,
      label: admin.email,
    },
    scope: grantedScopes,
    props: buildMcpOauthProps(
      {
        ...admin,
        scopes: grantedScopes,
      },
      grantedScopes,
      "oauth",
    ),
  });

  return mcpOauthRedirectResponseSchema.parse({ redirectTo });
}

async function handleAuthorizePost(request: Request, env: McpOAuthEnv, ctx: ExecutionContext): Promise<Response> {
  const { action, email, returnTo } = await parseAuthorizePayload(request);

  if (action === "request-link") {
    return handleMagicLinkRequest(request, env, ctx, email, returnTo);
  }

  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);

  if (action === "deny") {
    const response = redirectAuthorizationDenied(authRequest);
    return jsonResponse(mcpOauthRedirectResponseSchema.parse({ redirectTo: response.headers.get("location") }), 200);
  }

  if (action === "approve") {
    return jsonResponse(await handleAuthorizeApproval(request, env, returnTo));
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
