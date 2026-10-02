import { Hono } from "hono";
import { logError } from "../_lib/logging";
import { resolveEventFlowShell } from "../_lib/services/events/public-shell";
import { servePublicSiteRequest } from "../_lib/services/site-rendering";
import { getStaticAssetsBinding } from "../_lib/static-assets";
import type { Env } from "../_lib/types";
import { siteSecurityHeaders } from "../../assets/shared/site-security-policy";

const PRIVATE_RESPONSE_HEADERS = {
  ...siteSecurityHeaders(),
  "cache-control": "no-store, max-age=0",
  "referrer-policy": "no-referrer",
  "x-robots-tag": "noindex, nofollow, noarchive",
} as const;

function privateHeaders(headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  for (const [name, value] of Object.entries(PRIVATE_RESPONSE_HEADERS)) result.set(name, value);
  return result;
}

function staticAssetRequest(request: Request, pathname = new URL(request.url).pathname, forceGet = false): Request {
  const url = new URL(pathname, request.url);
  url.search = "";
  url.hash = "";
  return new Request(url, { method: forceGet ? "GET" : request.method });
}

function secureShellResponse(response: Response, headOnly: boolean): Response {
  const headers = privateHeaders(response.headers);
  return new Response(headOnly ? null : response.body, { status: response.status, headers });
}

async function secureRenderedShell(request: Request, env: Env, shellPath: string): Promise<Response> {
  let response = await servePublicSiteRequest(request, env, { privatePage: true });
  if (response.status === 404) {
    response = await servePublicSiteRequest(request, env, {
      canonicalPath: new URL(request.url).pathname,
      pagePath: shellPath,
      privatePage: true,
    });
  }
  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    headers: privateHeaders(response.headers),
  });
}

async function serveEventPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: privateHeaders({ allow: "GET, HEAD", "content-type": "text/plain; charset=UTF-8" }),
    });
  }

  const pathname = new URL(request.url).pathname;
  const shell = resolveEventFlowShell(pathname);
  const assets = getStaticAssetsBinding(env);
  if (!assets) return shell ? secureRenderedShell(request, env, shell.assetPath) : servePublicSiteRequest(request, env);

  try {
    const staticResponse = await assets.fetch(staticAssetRequest(request));
    if (staticResponse.status !== 404)
      return shell ? secureShellResponse(staticResponse, request.method === "HEAD") : staticResponse;

    if (!shell) return staticResponse;

    const shellResponse = await assets.fetch(staticAssetRequest(request, shell.assetPath, true));
    if (!shellResponse.ok) {
      logError("PORTAL_EVENT_FLOW_SHELL_ASSET_MISSING", { assetPath: shell.assetPath });
      return secureRenderedShell(request, env, shell.assetPath);
    }
    return secureShellResponse(shellResponse, request.method === "HEAD");
  } catch (error) {
    logError("PORTAL_EVENT_FLOW_SHELL_FAILED", {
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.message : "Unknown shell failure",
    });
    return shell
      ? secureRenderedShell(request, env, shell.assetPath)
      : new Response("Static publication unavailable", { status: 503 });
  }
}

const app = new Hono<{ Bindings: Env }>();
app.all("/*", (context) => serveEventPage(context.req.raw, context.env));

export default app;
