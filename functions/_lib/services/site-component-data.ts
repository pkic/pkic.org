import type { SiteListing, SiteListingItem } from "../../../assets/shared/site-content";
import type { ContentCollectionKind } from "./site-components";
import { normalizedContentPath, type FrontMatter } from "./site-markdown";
import { contentMediaUrl } from "../../../assets/shared/content-media-url";

export interface ComponentContentDocument {
  data: FrontMatter;
  isSection: boolean;
  nodePath: string;
}

export function matchingContentAssetUrls(
  sourcePath: string,
  contentMediaPaths: readonly string[],
  pattern = "*",
): string[] {
  const source = normalizedContentPath(sourcePath);
  const directory = source.includes("/") ? source.slice(0, source.lastIndexOf("/")) : "";
  const absolutePattern = [directory, pattern].filter(Boolean).join("/");
  const expression = new RegExp(
    `^${absolutePattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("**", "::DOUBLE_STAR::")
      .replaceAll("*", "[^/]*")
      .replaceAll("::DOUBLE_STAR::", ".*")}$`,
  );
  return contentMediaPaths.filter((path) => expression.test(path)).map(contentMediaUrl);
}

export function inheritedEventDocument<TDocument extends ComponentContentDocument>(
  document: TDocument,
  documents: readonly TDocument[],
): TDocument | undefined {
  return documents
    .filter(
      (candidate) =>
        Boolean(candidate.data.data) &&
        (candidate.nodePath === document.nodePath || document.nodePath.startsWith(`${candidate.nodePath}/`)),
    )
    .sort((a, b) => b.nodePath.length - a.nodePath.length)[0];
}

export function contentComponentListing<TDocument extends ComponentContentDocument>(
  kind: ContentCollectionKind,
  documents: readonly TDocument[],
  datedDocuments: readonly TDocument[],
  toItem: (document: TDocument) => SiteListingItem,
  limit?: number,
): SiteListing {
  const eventDate = (document: ComponentContentDocument): string =>
    String(document.data.params?.eventDate ?? document.data.eventDate ?? "");
  let selected: TDocument[];
  let heading: string;
  let listingKind: SiteListing["kind"];
  if (kind === "recent-posts") {
    selected = [...datedDocuments];
    heading = "Latest from the Blog";
    listingKind = "blog";
  } else if (kind === "working-groups") {
    selected = documents
      .filter(
        (document) =>
          document.isSection &&
          document.nodePath.split("/").length === 2 &&
          document.nodePath.startsWith("wg/") &&
          Boolean(document.data.card),
      )
      .sort(
        (a, b) =>
          (a.data.card?.order ?? Number.MAX_SAFE_INTEGER) - (b.data.card?.order ?? Number.MAX_SAFE_INTEGER) ||
          String(a.data.title ?? "").localeCompare(String(b.data.title ?? "")),
      );
    heading = "Working Groups";
    listingKind = "working-groups";
  } else {
    const today = new Date().toISOString().slice(0, 10);
    selected = documents
      .filter(
        (document) =>
          document.data.draft !== true &&
          document.data.params?.eventType === "conference" &&
          Boolean(eventDate(document)),
      )
      .sort((a, b) => {
        const aDate = eventDate(a);
        const bDate = eventDate(b);
        const aUpcoming = aDate >= today;
        const bUpcoming = bDate >= today;
        if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
        return aUpcoming ? aDate.localeCompare(bDate) : bDate.localeCompare(aDate);
      });
    heading = "Events";
    listingKind = "events";
  }
  const items = selected.slice(0, limit ?? selected.length).map(toItem);
  if (kind === "events") {
    for (let index = 0; index < items.length; index += 1) items[index].date = eventDate(selected[index]);
  }
  return {
    heading,
    items,
    kind: listingKind,
    layout: "band",
    page: 1,
    pageCount: 1,
  };
}
