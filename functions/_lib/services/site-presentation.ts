import { plainText } from "../../../assets/shared/markdown-plain-text";
import { siteStatistics } from "../../../assets/shared/site-statistics";
import { portalLoginCopySchema } from "../../../assets/shared/schemas/portal-login-copy";
import type {
  SiteHero,
  SiteHeroTone,
  SiteListingItem,
  SiteSectionNavigation,
} from "../../../assets/shared/site-content";
import { normalizedContentPath, type FrontMatter } from "./site-markdown";
import { bylineFor } from "./site-authors";
import { stripContentComponentSyntax } from "./site-components";
import { siteContentLanguagePrefix, type SiteContentLanguage } from "../../../assets/shared/site-content-language";

export interface SitePresentationDocument {
  body: string;
  data: FrontMatter;
  isSection: boolean;
  language: SiteContentLanguage;
  nodePath: string;
  route: string;
  sourcePath: string;
}

export { plainText } from "../../../assets/shared/markdown-plain-text";

export function contentAssetUrl(document: SitePresentationDocument, assetName?: string): string | undefined {
  if (!assetName) return undefined;
  if (/^(?:[a-z]+:)?\/\//i.test(assetName) || assetName.startsWith("/")) return assetName;
  const source = normalizedContentPath(document.sourcePath);
  const directory = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
  const path = ["content-media", directory, assetName]
    .filter(Boolean)
    .flatMap((part) => part.split("/"))
    .map(encodeURIComponent)
    .join("/");
  return `/${path}`;
}

export function createSitePresentation<TDocument extends SitePresentationDocument>(documents: readonly TDocument[]) {
  const ancestors = (document: TDocument): TDocument[] =>
    documents
      .filter(
        (candidate) =>
          candidate.language === document.language &&
          (candidate.nodePath === document.nodePath || document.nodePath.startsWith(`${candidate.nodePath}/`)),
      )
      .sort((a, b) => a.nodePath.length - b.nodePath.length);

  const paramsFor = (document: TDocument): Record<string, unknown> => ({
    ...ancestors(document).reduce<Record<string, unknown>>(
      (params, candidate) => ({ ...params, ...(candidate.data.cascade?.params ?? {}) }),
      {},
    ),
    ...(document.data.params ?? {}),
  });

  const parameterSource = (document: TDocument, key: string): TDocument =>
    ancestors(document)
      .reverse()
      .find(
        (candidate) =>
          Object.hasOwn(candidate.data.params ?? {}, key) || Object.hasOwn(candidate.data.cascade?.params ?? {}, key),
      ) ?? document;

  const rawDescriptionFor = (document: TDocument): string | undefined => {
    const description =
      paramsFor(document).heroDescription ??
      document.data.heroDescription ??
      document.data.description ??
      document.data.summary;
    return description ? String(description) : undefined;
  };

  const descriptionFor = (document: TDocument): string | undefined => {
    const description =
      paramsFor(document).heroDescription ??
      document.data.heroDescription ??
      document.data.description ??
      document.data.summary;
    return description ? plainText(String(description)) : undefined;
  };

  const titleFor = (document: TDocument): string =>
    String(paramsFor(document).heroTitle ?? document.data.heroTitle ?? document.data.title ?? "PKI Consortium");

  const PAGE_COLOURS = new Set<SiteHeroTone>(["blue", "green", "orange", "purple", "teal"]);

  const heroToneFor = (document: TDocument): SiteHeroTone => {
    // A page that declares its own colour takes that theme, which is how each
    // working group's hero carries the group's accent rather than one green.
    const declared = String(paramsFor(document).color ?? document.data.color ?? "").toLowerCase() as SiteHeroTone;
    if (PAGE_COLOURS.has(declared)) return declared;
    const route = document.route.slice(siteContentLanguagePrefix(document.language).length);
    if (route === "/wg/" || route.startsWith("/wg/")) return "default";
    if (route === "/blog/" || /^\/\d{4}\/\d{2}\/\d{2}\//.test(route)) return "blog";
    if (route.startsWith("/events/")) return "events";
    if (route.startsWith("/members/")) return "members";
    if (route.startsWith("/about/")) return "about";
    if (route.startsWith("/resources/")) return "resources";
    return "default";
  };

  /*
   * The page's accent pair.
   *
   * Hugo's `page-theme-colors` partial resolved one from the page's own
   * `color` and otherwise from its section, and every heading, link underline
   * and call to action on the page reads it. The pairs are named rather than
   * emitted inline because the site's CSP refuses a style attribute.
   */
  const pageAccentFor = (document: TDocument): string => {
    const declared = String(paramsFor(document).color ?? document.data.color ?? "").toLowerCase();
    if (["blue", "green", "orange", "purple", "red", "teal"].includes(declared)) return declared;
    const [section] = document.nodePath.split("/");
    const bySection: Record<string, string> = {
      about: "green",
      activities: "resources",
      blog: "blue",
      events: "orange",
      members: "purple",
      resources: "resources",
      wg: "green",
    };
    return bySection[section] ?? "green";
  };

  const heroFor = (document: TDocument): SiteHero => {
    const params = paramsFor(document);
    const heroImage = typeof params.heroImage === "string" ? params.heroImage : document.data.heroImage;
    // `heroButton` is written at the top of a page's front matter as often as
    // it is cascaded through `params`, and the published hero read either.
    const declaredButton = params.heroButton ?? document.data.heroButton;
    const heroButton =
      declaredButton && typeof declaredButton === "object" && !Array.isArray(declaredButton)
        ? (declaredButton as Record<string, unknown>)
        : undefined;
    const sponsorWeight = Number(params.heroSponsorLevel);
    const heroHeight = Math.max(
      50,
      ...[params.heroHeight, params.heroMaxHeight].map((value) =>
        typeof value === "string" && /^\d+vh$/.test(value) ? Number(value.slice(0, -2)) : 0,
      ),
    );
    return {
      button:
        typeof heroButton?.label === "string" && typeof heroButton.link === "string"
          ? { href: heroButton.link, label: heroButton.label }
          : undefined,
      description: descriptionFor(document),
      eyebrow: document.data.wgID
        ? `Working Group — ${String(document.data.wgID).toUpperCase()}`
        : document.data.layout === "webinar" && typeof params.sponsorName === "string"
          ? `Sponsored Webinar by ${params.sponsorName}`
          : (document.data.heroHeader ?? (typeof params.heroKicker === "string" ? params.heroKicker : undefined)),
      imageAlt: titleFor(document),
      imageSrc: contentAssetUrl(parameterSource(document, "heroImage"), heroImage),
      imageSize: heroHeight > 75 ? "full" : heroHeight > 55 ? "tall" : "default",
      sponsor:
        Number.isFinite(sponsorWeight) && sponsorWeight > 0
          ? {
              eventName: typeof params.sponsoring === "string" ? params.sponsoring : undefined,
              eventSlug: typeof params.sponsoringSlug === "string" ? params.sponsoringSlug : undefined,
              minimumWeight: sponsorWeight,
            }
          : undefined,
      icon: document.data.wgID ? (document.data.card?.icon ?? String(document.data.wgID).toLowerCase()) : undefined,
      title: titleFor(document),
      tone: heroToneFor(document),
      wgId: document.data.wgID ? String(document.data.wgID).toLowerCase() : undefined,
    };
  };

  const socialCardFor = (document: TDocument) => {
    const params = paramsFor(document);
    const image = params.socialCardImage ?? document.data.socialCardImage;
    const variant =
      params.eventType === "webinar" || document.data.eventType === "webinar" ? ("webinar" as const) : undefined;
    return {
      variant,
      imageSrc:
        typeof image === "string" ? contentAssetUrl(parameterSource(document, "socialCardImage"), image) : undefined,
      imageRound: false,
      sponsorSlug: typeof params.sponsor === "string" ? params.sponsor : undefined,
    };
  };

  const plainSummary = (document: TDocument): string | undefined => {
    const explicit = document.data.summary ?? document.data.description;
    const text = explicit
      ? plainText(explicit)
      : stripContentComponentSyntax(document.body)
          .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
          .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
          .replace(/[#>*_`~|-]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
    if (!text) return undefined;
    const limit = explicit ? 237 : 177;
    return `${text.slice(0, limit)}${text.length > limit ? "…" : ""}`;
  };

  const listingItem = (document: TDocument): SiteListingItem => {
    const params = paramsFor(document);
    const heroImage = typeof params.heroImage === "string" ? params.heroImage : document.data.heroImage;
    const duration = Number(params.eventDuration ?? document.data.params?.eventDuration);
    const declaredButton = params.heroButton ?? document.data.heroButton;
    const itemButton =
      declaredButton && typeof declaredButton === "object" && !Array.isArray(declaredButton)
        ? (declaredButton as Record<string, unknown>)
        : undefined;
    return {
      authors: bylineFor(document),
      date: document.data.date ? String(document.data.date) : undefined,
      duration: Number.isFinite(duration) && duration > 1 ? duration : undefined,
      href: document.route,
      imageSrc: contentAssetUrl(parameterSource(document, "heroImage"), heroImage),
      button:
        typeof itemButton?.label === "string" && typeof itemButton.link === "string"
          ? { href: itemButton.link, label: itemButton.label }
          : undefined,
      // An event's `heroDescription` is its venue and dates, which the event
      // card shows under the title where a post shows its date.
      location: params.eventType
        ? ((params.heroDescription ?? document.data.heroDescription) as string | undefined)
        : undefined,
      links: document.data.card?.links
        ?.filter((link) => link.text && link.url)
        .map((link) => ({ href: link.url!, label: link.text!, tone: link.chip })),
      summary: document.data.card?.description ?? plainSummary(document),
      tag: document.data.wgID ?? document.data.tags?.[0],
      tags: document.data.tags,
      theme: document.data.card?.icon,
      title: params.eventType ? titleFor(document) : (document.data.title ?? titleFor(document)),
    };
  };

  const sectionNavigationFor = (document: TDocument): SiteSectionNavigation | undefined => {
    if (paramsFor(document).sectionNav !== true) return undefined;
    const root = ancestors(document)
      .reverse()
      .find(
        (candidate) =>
          candidate.isSection &&
          (candidate.data.params?.sectionNav === true || candidate.data.cascade?.params?.sectionNav === true),
      );
    if (!root) return undefined;
    const children = documents
      .filter(
        (candidate) =>
          candidate.language === document.language &&
          candidate.isSection &&
          candidate !== root &&
          candidate.nodePath.startsWith(`${root.nodePath}/`) &&
          candidate.nodePath.slice(root.nodePath.length + 1).split("/").length === 1 &&
          candidate.data.robots !== "noindex" &&
          candidate.data.draft !== true,
      )
      .sort((a, b) => (a.data.weight ?? 0) - (b.data.weight ?? 0) || titleFor(a).localeCompare(titleFor(b)));
    // Attendees reach their event app (portal event page) from every event page until the event ends.
    const rootParams = paramsFor(root);
    const eventSlug = typeof rootParams.sponsoringSlug === "string" ? rootParams.sponsoringSlug : undefined;
    const eventDate = Date.parse(String(rootParams.eventDate ?? ""));
    const eventDays = Number(rootParams.eventDuration ?? 1);
    const eventEnded = Number.isFinite(eventDate) && eventDate + Math.max(1, eventDays) * 86_400_000 < Date.now();
    return {
      currentPath: document.route,
      ...(eventSlug && !eventEnded ? { appHref: `/portal/#/events/${encodeURIComponent(eventSlug)}` } : {}),
      items: [root, ...children].map((item) => ({
        href: item.route,
        label: item.data.linkTitle ?? item.data.title ?? titleFor(item),
      })),
    };
  };

  return {
    socialCardFor,
    descriptionFor,
    heroFor,
    listingItem,
    pageAccentFor,
    plainSummary,
    rawDescriptionFor,
    sectionNavigationFor,
    titleFor,
  };
}

export function portalLoginCopy(value: unknown, workingGroupCount: number) {
  const copy = portalLoginCopySchema.parse(value ?? {});
  return portalLoginCopySchema.parse({
    ...copy,
    facts: [
      ...siteStatistics(workingGroupCount).map((fact) => ({
        ...fact,
        label: fact.label.toLowerCase(),
      })),
      ...(copy.facts ?? []),
    ],
  });
}
