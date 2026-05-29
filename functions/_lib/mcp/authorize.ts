import type { Hono } from "hono";
import type { Env } from "../types";
import {
  MCP_OAUTH_AUTHORIZE_PATH,
  MCP_OAUTH_AUTHORIZE_VERIFY_PATH,
  buildMcpOauthProps,
  currentAuthorizeReturnTo,
  grantedMcpOauthScopes,
  normalizeMcpOauthScopes,
  parseOauthRequestFromReturnTo,
  redirectAuthorizationDenied,
  renderMcpAuthorizeConsentPage,
  renderMcpAuthorizeLoginPage,
  requireMcpOauthAdmin,
  sanitizeAuthorizeReturnTo,
  sendMcpAuthorizeMagicLink,
  serializeExpiredMcpOauthLoginCookie,
  toOAuthErrorResponse,
  type McpOAuthEnv,
  verifyMcpAuthorizeMagicLink,
} from "./oauth";

interface McpAuthorizeHandlerOptions {
  app: Hono<{ Bindings: Env }>;
}

async function handleAuthorizeGet(request: Request, env: McpOAuthEnv): Promise<Response> {
  const authRequest = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  const admin = await requireMcpOauthAdmin(request, env);
  if (!admin) {
    return renderMcpAuthorizeLoginPage({
      clientInfo,
      returnTo: currentAuthorizeReturnTo(request),
    });
  }

  const requestedScopes = normalizeMcpOauthScopes(authRequest.scope);
  const grantedScopes = grantedMcpOauthScopes(admin, requestedScopes);
  return renderMcpAuthorizeConsentPage({
    admin,
    clientInfo,
    requestedScopes,
    grantedScopes,
    returnTo: currentAuthorizeReturnTo(request),
  });
}

async function handleMagicLinkRequest(
  request: Request,
  env: McpOAuthEnv,
  ctx: ExecutionContext,
  formData: FormData,
  returnTo: string,
): Promise<Response> {
  const email = String(formData.get("email") ?? "").trim();
  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
  await sendMcpAuthorizeMagicLink({ request, env, executionCtx: ctx, email, returnTo });
  return renderMcpAuthorizeLoginPage({
    clientInfo,
    returnTo,
    sentTo: email || null,
  });
}

async function handleAuthorizeApproval(request: Request, env: McpOAuthEnv, returnTo: string): Promise<Response> {
  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);
  const admin = await requireMcpOauthAdmin(request, env);
  if (!admin) {
    const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
    return renderMcpAuthorizeLoginPage({
      clientInfo,
      returnTo,
      error: "Your authorization session expired. Request a new sign-in link.",
    });
  }

  const requestedScopes = normalizeMcpOauthScopes(authRequest.scope);
  const grantedScopes = grantedMcpOauthScopes(admin, requestedScopes);
  if (grantedScopes.length === 0) {
    const clientInfo = await env.OAUTH_PROVIDER.lookupClient(authRequest.clientId);
    return renderMcpAuthorizeConsentPage({
      admin,
      clientInfo,
      requestedScopes,
      grantedScopes,
      returnTo,
    });
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

  return Response.redirect(redirectTo, 302);
}

async function handleAuthorizePost(request: Request, env: McpOAuthEnv, ctx: ExecutionContext): Promise<Response> {
  const formData = await request.formData();
  const action = String(formData.get("action") ?? "");
  const returnTo = sanitizeAuthorizeReturnTo(formData.get("return_to")?.toString());

  if (action === "request-link") {
    return handleMagicLinkRequest(request, env, ctx, formData, returnTo);
  }

  const authRequest = await parseOauthRequestFromReturnTo(request, env.OAUTH_PROVIDER, returnTo);

  if (action === "deny") {
    const response = redirectAuthorizationDenied(authRequest);
    response.headers.append("Set-Cookie", serializeExpiredMcpOauthLoginCookie(request));
    return response;
  }

  if (action === "approve") {
    return handleAuthorizeApproval(request, env, returnTo);
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

async function handleAuthorizeVerify(request: Request, env: McpOAuthEnv): Promise<Response> {
  try {
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405 });
    }
    const { response } = await verifyMcpAuthorizeMagicLink(request, env);
    return response;
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

      if (url.pathname === MCP_OAUTH_AUTHORIZE_VERIFY_PATH) {
        return await handleAuthorizeVerify(request, env);
      }

      return await options.app.fetch(request, env, ctx);
    },
  };
}
