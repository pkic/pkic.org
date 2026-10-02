import { Hono } from "hono";
import { getStaticAssetsBinding } from "../_lib/static-assets";
import { isSiteDiscoveryPath, serveSiteDiscoveryRequest } from "../_lib/services/site-discovery";
import { servePublicSiteRequest } from "../_lib/services/site-rendering";
import type { Env } from "../_lib/types";

const app = new Hono<{ Bindings: Env }>();

app.all("*", async (context) => {
  const request = context.req.raw;
  if (request.method !== "GET" && request.method !== "HEAD") return context.notFound();
  const assets = getStaticAssetsBinding(context.env);
  if (assets) return assets.fetch(request);
  const pathname = new URL(request.url).pathname;
  if (isSiteDiscoveryPath(pathname)) return await serveSiteDiscoveryRequest(request, context.env);
  return servePublicSiteRequest(request, context.env);
});

export default app;
