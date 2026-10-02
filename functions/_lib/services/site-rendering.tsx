import { PortalPage } from "../../../assets/ts/site/PortalPage";
import { render } from "preact-render-to-string";
import type { ComponentChildren } from "preact";
import { NotFoundPage } from "../../../assets/ts/site/SitePages";
import { SitePageBody } from "../../../assets/ts/site/SitePageBody";
import { SiteDocument, type SiteAssets } from "../../../assets/ts/site/SiteDocument";
import { getStaticAssetsBinding } from "../static-assets";
import { countPublicMembers } from "./membership/directory";
import type { Env } from "../types";
import { clientAssetManifestSchema } from "../../../assets/shared/schemas/client-assets";
import { loadSiteContent, normalizeSitePath, siteNavigation, siteRedirectTarget } from "./site-content";
import { siteSecurityHeaders } from "../../../assets/shared/site-security-policy";

export interface SiteRequestOptions {
  canonicalPath?: string;
  pagePath?: string;
  privatePage?: boolean;
}

export interface PublishedPageOptions extends SiteRequestOptions {
  assets: SiteAssets;
  memberCount?: number;
  body?: ComponentChildren;
  title?: string;
}

async function loadSiteAssets(request: Request, env: Env): Promise<SiteAssets> {
  const binding = getStaticAssetsBinding(env);
  if (binding) {
    const manifestUrl = new URL("/js/built/manifest.json", request.url);
    const response = await binding.fetch(new Request(manifestUrl));
    if (response.ok) {
      const parsed = clientAssetManifestSchema.safeParse(await response.json());
      if (parsed.success) {
        const value = parsed.data;
        return {
          scriptUrl: value.loader.url,
          scriptIntegrity: value.loader.integrity,
          stylesheets: [...value.loader.stylesheets, ...(value.publicSite?.stylesheets ?? [])],
          publicScriptUrl: value.publicSite?.url,
          publicScriptIntegrity: value.publicSite?.integrity,
        };
      }
    }
  }
  return {
    scriptUrl: "/js/built/loader.js",
    stylesheets: [{ url: "/js/built/loader.css" }, { url: "/js/built/publicSite.css" }],
    publicScriptUrl: "/js/built/publicSite.js",
  };
}

function htmlHeaders(privatePage: boolean, robots: string | undefined, pathname: string): Headers {
  const noIndex = privatePage || /(?:^|,)\s*noindex\b/i.test(robots ?? "");
  return new Headers({
    ...siteSecurityHeaders(pathname),
    "cache-control": privatePage ? "no-store, max-age=0" : "public, max-age=60, stale-while-revalidate=300",
    "content-type": "text/html; charset=UTF-8",
    ...(noIndex ? { "x-robots-tag": robots ?? "noindex, nofollow, noarchive" } : {}),
  });
}

/**
 * The member total the home page states.
 *
 * The directory is the published source for that number, and a database that
 * cannot answer must not replace the page with an error, so the stat falls
 * back to its unknown state.
 */
async function publishedMemberCount(env: Env): Promise<number | undefined> {
  try {
    return await countPublicMembers(env.DB, "organization");
  } catch {
    return undefined;
  }
}

function canonicalUrl(request: Request, pagePath: string): string {
  const url = new URL(request.url);
  url.pathname = normalizeSitePath(pagePath);
  url.search = "";
  url.hash = "";
  return url.toString();
}

export async function renderPublishedSitePage(request: Request, options: PublishedPageOptions): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }

  const requestUrl = new URL(request.url);
  const requestPath = requestUrl.pathname;
  const pagePath = options.pagePath ?? requestPath;
  const canonicalPath = options.canonicalPath ?? requestPath;
  const aliasTarget = siteRedirectTarget(pagePath);
  if (aliasTarget) return Response.redirect(new URL(aliasTarget, request.url).toString(), 308);
  const content = await loadSiteContent(pagePath, { query: requestUrl.searchParams.get("q") ?? undefined });
  if (content?.redirect) return Response.redirect(new URL(content.redirect, request.url).toString(), 302);
  if (content && pagePath !== "/" && !pagePath.endsWith("/")) {
    const destination = new URL(request.url);
    destination.pathname = normalizeSitePath(pagePath);
    return Response.redirect(destination.toString(), 308);
  }
  const assets = options.assets;
  const privatePage = options.privatePage ?? normalizeSitePath(pagePath) === "/portal/";
  const status = content && !content.draft ? 200 : 404;
  const title = status === 404 ? "Page not found" : (options.title ?? content!.title);
  const body =
    options.body ??
    (status === 404 ? (
      <NotFoundPage />
    ) : content!.portalLogin ? (
      <PortalPage copy={content!.portalLogin} />
    ) : (
      <SitePageBody content={content!} memberCount={options.memberCount} />
    ));
  const document = render(
    <SiteDocument
      assets={assets}
      canonicalUrl={canonicalUrl(request, canonicalPath)}
      currentPath={normalizeSitePath(canonicalPath)}
      description={content?.description}
      keywords={content?.keywords}
      navigation={siteNavigation()}
      ogCardVersion={content?.lastModified}
      pageAccent={content?.pageAccent}
      privatePage={privatePage}
      robots={privatePage ? "noindex, nofollow, noarchive" : content?.robots}
      title={title}
    >
      {body}
    </SiteDocument>,
  );
  return new Response(request.method === "HEAD" ? null : `<!doctype html>${document}`, {
    status,
    headers: htmlHeaders(privatePage, content?.robots, canonicalPath),
  });
}

export async function servePublicSiteRequest(
  request: Request,
  env: Env,
  options: Omit<PublishedPageOptions, "assets"> = {},
): Promise<Response> {
  return renderPublishedSitePage(request, {
    ...options,
    assets: await loadSiteAssets(request, env),
    memberCount:
      normalizeSitePath(options.pagePath ?? new URL(request.url).pathname) === "/"
        ? await publishedMemberCount(env)
        : undefined,
  });
}
