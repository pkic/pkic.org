import type { Hono } from "hono";
import type { Env } from "../types";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_VERIFY_API_PATH,
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
  serializeExpiredMcpOauthLoginCookie,
  serializeMcpOauthLoginCookie,
  toOAuthErrorResponse,
  type McpOAuthEnv,
  verifyMcpAuthorizeMagicLink,
  wantsJsonResponse,
} from "./oauth";

interface McpAuthorizeHandlerOptions {
  app: Hono<{ Bindings: Env }>;
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json;charset=UTF-8" },
  });
}

async function parseAuthorizePayload(request: Request): Promise<{ action: string; email: string; returnTo: string }> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      email?: unknown;
      return_to?: unknown;
    };

    return {
      action: String(body.action ?? ""),
      email: String(body.email ?? "").trim(),
      returnTo: sanitizeAuthorizeReturnTo(typeof body.return_to === "string" ? body.return_to : null),
    };
  }

  const formData = await request.formData();
  return {
    action: String(formData.get("action") ?? ""),
    email: String(formData.get("email") ?? "").trim(),
    returnTo: sanitizeAuthorizeReturnTo(formData.get("return_to")?.toString()),
  };
}

async function handleAuthorizeGet(request: Request, env: McpOAuthEnv): Promise<Response> {
  const returnTo = resolveAuthorizeReturnTo(request);
  if (!wantsJsonResponse(request)) {
    return redirectToMcpOauthUi(env, request, returnTo);
  }

  return jsonResponse(await describeMcpAuthorization(request, env, returnTo));
}

async function handleMagicLinkRequest(
  request: Request,
  env: McpOAuthEnv,
  ctx: ExecutionContext,
  email: string,
  returnTo: string,
): Promise<Response> {
  await sendMcpAuthorizeMagicLink({ request, env, executionCtx: ctx, email, returnTo });
  return jsonResponse({ success: true, sentTo: email || null });
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

  return { redirectTo };
}

async function handleAuthorizePost(request: Request, env: McpOAuthEnv, ctx: ExecutionContext): Promise<Response> {
  const { action, email, returnTo } = await parseAuthorizePayload(request);

  if (action === "request-link") {
    return handleMagicLinkRequest(request, env, ctx, email, returnTo);
  }

  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);

  if (action === "deny") {
    const response = redirectAuthorizationDenied(authRequest);
    response.headers.append("Set-Cookie", serializeExpiredMcpOauthLoginCookie(request));
    return jsonResponse({ redirectTo: response.headers.get("location") }, 200);
  }

  if (action === "approve") {
    return jsonResponse(await handleAuthorizeApproval(request, env, returnTo));
  }

  return new Response("Method not allowed", { status: 405 });
}

async function handleVerifyApi(request: Request, env: McpOAuthEnv): Promise<Response> {
  try {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const body = (await request.json().catch(() => ({}))) as { token?: unknown };
    const token = typeof body.token === "string" ? body.token : "";
    const verifyRequest = new Request(`${request.url}?token=${encodeURIComponent(token)}`, {
      method: "GET",
      headers: request.headers,
    });
    const verified = await verifyMcpAuthorizeMagicLink(verifyRequest, env);
    const response = jsonResponse({
      success: true,
      expiresAt: verified.expiresAt,
      returnTo: verified.returnTo,
      admin: verified.admin,
    });
    response.headers.append("Set-Cookie", serializeMcpOauthLoginCookie(verified.sessionToken, request));
    return response;
  } catch (error) {
    return toOAuthErrorResponse(error);
  }
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

      if (url.pathname === MCP_OAUTH_VERIFY_API_PATH) {
        return await handleVerifyApi(request, env);
      }

      return await options.app.fetch(request, env, ctx);
    },
  };
}
