import { publishedFormResourcesForPath } from "../assets/shared/published-resource-url";
import { siteContentLanguageForPath } from "../assets/shared/site-content-language";
import type { PublicMemberDetail } from "../assets/shared/schemas/members-directory";
import type { SiteContentPage } from "../assets/shared/site-content";
import { siteNavigation } from "../functions/_lib/services/site-content";
import { clientAssets } from "./client-assets";
import { memberCounts, publication } from "./publication";
import { PUBLICATION_SITE_ORIGIN, publicationImageInputs } from "./publication-cache";
import { preparePublicationImages } from "../assets/ts/site/SiteImage";
import { socialCardDescriptor } from "./social-card";

type SocialContent = Pick<
  SiteContentPage,
  "workingGroup" | "hero" | "taxonomy" | "blog" | "socialCard" | "pageAccent" | "meta"
>;

/** The public layout consumes this same projection that participates in route keys. */
export async function publicationPageInputs({
  route,
  title,
  description,
  privatePage = false,
  accent,
  robots,
  content,
  member,
  structuredData,
  imageRefs = [],
}: {
  route: string;
  title: string;
  description?: string;
  privatePage?: boolean;
  accent?: string;
  robots?: string;
  content?: SocialContent;
  member?: PublicMemberDetail;
  structuredData?: unknown;
  imageRefs?: Parameters<typeof preparePublicationImages>[0];
}) {
  const socialCard =
    privatePage || robots?.includes("noindex")
      ? undefined
      : socialCardDescriptor({ route, title, description, content, member, publication });
  const memberWall = privatePage ? [] : publication.memberWall;
  const sources = [
    ...memberWall.map((entry) => entry.logoUrl),
    socialCard?.hero,
    socialCard?.visual,
    ...(socialCard?.authors.map((entry) => entry.photo) ?? []),
    ...(socialCard?.leaders.map((entry) => entry.photo) ?? []),
    ...(socialCard?.logos.map((entry) => entry.src) ?? []),
    ...(socialCard?.sponsors.map((entry) => entry.src) ?? []),
    ...imageRefs.map((entry) => entry.source),
  ].filter((source): source is string => Boolean(source));
  const renderedImageRefs = [...memberWall.map((entry) => ({ source: entry.logoUrl, portrait: false })), ...imageRefs];
  const imagesPrepared = await preparePublicationImages(renderedImageRefs);
  const { locale, timeZone } = Intl.DateTimeFormat().resolvedOptions();
  return {
    presentation: { locale, timeZone },
    copyrightYear: new Date().getUTCFullYear(),
    route,
    language: siteContentLanguageForPath(route),
    canonicalUrl: new URL(route, PUBLICATION_SITE_ORIGIN).href,
    title,
    description,
    privatePage,
    accent,
    robots: privatePage ? "noindex, nofollow, noarchive" : robots,
    structuredData: privatePage ? undefined : structuredData,
    socialCard,
    renderedImageRefs,
    imageInputs: imagesPrepared ? publicationImageInputs(sources) : { cacheable: false as const },
    navigation: siteNavigation(),
    memberCounts,
    memberWall,
    publicResources:
      route === "/portal/" ? undefined : publishedFormResourcesForPath(publication.publicResources, route),
    clientAssets: {
      loader: { url: clientAssets.loader.url, integrity: clientAssets.loader.integrity },
      publicSite: clientAssets.publicSite
        ? { url: clientAssets.publicSite.url, integrity: clientAssets.publicSite.integrity }
        : undefined,
    },
  };
}

export type PublicationPageInputs = Awaited<ReturnType<typeof publicationPageInputs>>;
