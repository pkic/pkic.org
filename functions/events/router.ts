import { Hono } from "hono";
import { logError } from "../_lib/logging";
import { resolveEventFlowShell } from "../_lib/services/events/public-shell";
import { getStaticAssetsBinding } from "../_lib/static-assets";
import type { Env } from "../_lib/types";

const EVENT_SHELL_CSP =
  "default-src 'none'; img-src 'self' https://pkic.org https://i.ytimg.com data:; form-action 'self'; base-uri 'self'; connect-src 'self' data:; block-all-mixed-content; style-src 'unsafe-inline' 'self'; font-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js https://pkic.github.io/self-assessment/; frame-ancestors 'none'";

const PRIVATE_RESPONSE_HEADERS = {
  "cache-control": "no-store, max-age=0",
  "content-security-policy": EVENT_SHELL_CSP,
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
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
  return new Response(headOnly ? null : response.body, { status: 200, headers });
}

function unavailableResponse(): Response {
  return new Response("Event page temporarily unavailable.", {
    status: 503,
    headers: privateHeaders({
      "content-type": "text/plain; charset=UTF-8",
    }),
  });
}

async function serveEventPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", {
      status: 405,
      headers: privateHeaders({ allow: "GET, HEAD", "content-type": "text/plain; charset=UTF-8" }),
    });
  }

  const assets = getStaticAssetsBinding(env);
  if (!assets) return unavailableResponse();

  try {
    const staticResponse = await assets.fetch(staticAssetRequest(request));
    if (staticResponse.status !== 404) return staticResponse;

    const shell = resolveEventFlowShell(new URL(request.url).pathname);
    if (!shell) return staticResponse;

    const shellResponse = await assets.fetch(staticAssetRequest(request, shell.assetPath, true));
    if (!shellResponse.ok) {
      logError("PORTAL_EVENT_FLOW_SHELL_ASSET_MISSING", { assetPath: shell.assetPath });
      return unavailableResponse();
    }
    return secureShellResponse(shellResponse, request.method === "HEAD");
  } catch (error) {
    logError("PORTAL_EVENT_FLOW_SHELL_FAILED", {
      path: new URL(request.url).pathname,
      error: error instanceof Error ? error.message : "Unknown shell failure",
    });
    return unavailableResponse();
  }
}

const app = new Hono<{ Bindings: Env }>();
app.all("/*", (context) => serveEventPage(context.req.raw, context.env));

export default app;
