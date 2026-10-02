import type { ComponentChildren } from "preact";
import type { SiteNavigation } from "../../shared/site-content";
import type { ClientStylesheet } from "../../shared/schemas/client-assets";
import { SiteFooter, SiteHeader, SiteMain } from "../ui/SiteChrome";
import { siteContentLanguageForPath } from "../../shared/site-content-language";
import { siteTaxonomyFeedHref } from "../../shared/site-feed-url";

export interface SiteAssets {
  publicScriptIntegrity?: string;
  publicScriptUrl?: string;
  scriptUrl?: string;
  scriptIntegrity?: string;
  stylesheets?: ClientStylesheet[];
}

interface SiteDocumentProps {
  assets: SiteAssets;
  canonicalUrl: string;
  children: ComponentChildren;
  currentPath: string;
  description?: string;
  keywords?: string[];
  navigation: SiteNavigation;
  memberCounts?: { organization: number; independent: number };
  ogCardVersion?: string;
  socialImage?: string;
  pageAccent?: string;
  privatePage?: boolean;
  robots?: string;
  title: string;
}

/**
 * The stable social-image address for this page. Static publication replaces
 * it with an immutable generated URL and publishes a redirect from this address.
 */
function socialCardUrl(canonicalUrl: string, version?: string): string {
  const url = new URL(canonicalUrl);
  const path = url.pathname.replace(/^\/|\/$/g, "") || "index";
  return new URL(`/og/${path}/og.jpg${version ? `?v=${encodeURIComponent(version)}` : ""}`, url.origin).toString();
}

export function SiteDocumentHead({
  assets,
  canonicalUrl,
  currentPath,
  description,
  keywords,
  ogCardVersion,
  socialImage,
  robots,
  title,
}: Pick<
  SiteDocumentProps,
  | "assets"
  | "canonicalUrl"
  | "currentPath"
  | "description"
  | "keywords"
  | "ogCardVersion"
  | "socialImage"
  | "robots"
  | "title"
>) {
  // Hugo appended the site name to every page but the home page.
  const fullTitle = currentPath === "/" ? title : `${title} | PKI Consortium`;
  const socialCard = socialImage ?? socialCardUrl(canonicalUrl, ogCardVersion);
  const taxonomyFeed = siteTaxonomyFeedHref(currentPath);
  return (
    <>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{fullTitle}</title>
      {description ? <meta name="description" content={description} /> : null}
      {keywords?.length ? <meta name="keywords" content={keywords.join(",")} /> : null}
      {robots ? <meta name="robots" content={robots} /> : null}
      <link rel="canonical" href={canonicalUrl} />
      <meta property="og:type" content={currentPath === "/" ? "website" : "article"} />
      <meta property="og:site_name" content="PKI Consortium" />
      <meta property="og:title" content={title} />
      {description ? <meta property="og:description" content={description} /> : null}
      <meta property="og:url" content={canonicalUrl} />
      <meta property="og:image" content={socialCard} data-pagefind-default-meta="image[content]" />
      <meta property="og:image:width" content="1200" />
      <meta property="og:image:height" content="630" />
      <meta property="og:image:type" content="image/jpeg" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:site" content="@PKIConsortium" />
      <meta name="twitter:title" content={title} />
      {description ? <meta name="twitter:description" content={description} /> : null}
      <meta name="twitter:image" content={socialCard} />
      {taxonomyFeed ? (
        <link rel="alternate" type="application/rss+xml" href={taxonomyFeed} title={`${title} feed`} />
      ) : null}
      <link rel="alternate" type="application/rss+xml" href="/feed/blog/index.xml" title="PKI Consortium blog" />
      <link rel="alternate" type="application/rss+xml" href="/news/feed.xml" title="PKI Consortium member news" />
      <link rel="icon" href="/favicon.svg" />
      <link
        rel="icon"
        type="image/png"
        sizes="180x180"
        href="/img/icon-180x180-black-trans.png"
        media="(prefers-color-scheme: light)"
      />
      <link
        rel="icon"
        type="image/png"
        sizes="180x180"
        href="/img/icon-180x180-white-trans.png"
        media="(prefers-color-scheme: dark)"
      />
      <link rel="apple-touch-icon" href="/img/icon-180x180-black-white.png" />
      {assets.stylesheets?.map((stylesheet) => (
        <link
          rel="stylesheet"
          key={stylesheet.url}
          href={stylesheet.url}
          integrity={stylesheet.integrity}
          crossOrigin={stylesheet.integrity ? "anonymous" : undefined}
        />
      ))}
      <script src="/js/theme-init.js"></script>
    </>
  );
}

export function SiteDocument(props: SiteDocumentProps) {
  const { assets, children, currentPath, navigation, memberCounts, pageAccent, privatePage } = props;
  return (
    <html lang={siteContentLanguageForPath(currentPath)}>
      <head>
        <SiteDocumentHead {...props} />
      </head>
      <body class={`pk-site${pageAccent ? ` pk-page--${pageAccent}` : ""}`}>
        <SiteHeader currentPath={currentPath} navigation={navigation} memberCounts={memberCounts} />
        <SiteMain privatePage={privatePage}>{children}</SiteMain>
        <SiteFooter navigation={navigation} privatePage={privatePage} />
        {assets.scriptUrl ? (
          <script
            type="module"
            src={assets.scriptUrl}
            integrity={assets.scriptIntegrity}
            crossOrigin={assets.scriptIntegrity ? "anonymous" : undefined}
          ></script>
        ) : null}
        {assets.publicScriptUrl ? (
          <script
            type="module"
            src={assets.publicScriptUrl}
            integrity={assets.publicScriptIntegrity}
            crossOrigin={assets.publicScriptIntegrity ? "anonymous" : undefined}
          ></script>
        ) : null}
      </body>
    </html>
  );
}
