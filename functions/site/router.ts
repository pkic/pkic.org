import { Hono } from "hono";
import { getStaticAssetsBinding } from "../_lib/static-assets";
import type { Env } from "../_lib/types";

const app = new Hono<{ Bindings: Env }>();

app.all("*", async (context) => {
  const request = context.req.raw;
  if (request.method !== "GET" && request.method !== "HEAD") return context.notFound();
  const assets = getStaticAssetsBinding(context.env);
  if (assets) return assets.fetch(request);
  // Rendering from source parses every content page; load it only when no static assets serve the site.
  const pathname = new URL(request.url).pathname;
  const discovery = await import("../_lib/services/site-discovery");
  if (discovery.isSiteDiscoveryPath(pathname)) return await discovery.serveSiteDiscoveryRequest(request, context.env);
  const { servePublicSiteRequest } = await import("../_lib/services/site-rendering");
  return servePublicSiteRequest(request, context.env);
});

export default app;
