import type { SiteEventsIndex, SiteListingItem } from "../../../assets/shared/site-content";
import type { ContentDocument } from "./site-documents";

/**
 * The events index: the consortium's own events by year, and the webinars.
 *
 * The index reads the whole catalog rather than the section's
 * children, because a webinar and a conference live in the same year folder
 * and are told apart by `eventType`.
 */
export interface EventsIndexSource {
  documents: readonly ContentDocument[];
  inlineMarkdownHtml: (value: string) => Promise<string>;
  listingItem: (document: ContentDocument) => SiteListingItem;
  parseYaml: (value: string) => unknown;
}

const eventDate = (document: ContentDocument): string =>
  String(document.data.params?.eventDate ?? document.data.eventDate ?? "");

const eventType = (document: ContentDocument): string =>
  String(document.data.params?.eventType ?? document.data.eventType ?? "");

export function createEventsIndex(source: EventsIndexSource) {
  const { documents, inlineMarkdownHtml, listingItem, parseYaml } = source;

  return async function eventsIndex(body: string): Promise<SiteEventsIndex> {
    // The `events-sidebar` block carries the sidebar's copy. Hugo stashed it on
    // the page and read it back in the layout; here the layout reads it from
    // the same place, the body of `/events/`.
    const sidebarBlock = /{{<\s*events-sidebar\s*>}}([\s\S]*?){{<\s*\/events-sidebar\s*>}}/.exec(body);
    const sidebar = sidebarBlock ? ((parseYaml(sidebarBlock[1] ?? "") ?? {}) as SiteEventsIndex["sidebar"]) : undefined;
    // The description is authored as Markdown, which the published layout ran
    // through `markdownify` before writing it into the card.
    if (sidebar?.description) sidebar.description = await inlineMarkdownHtml(sidebar.description);

    const today = new Date().toISOString().slice(0, 10);
    const events = documents.filter((document) => document.data.draft !== true && eventDate(document));
    const conferences = events.filter((document) => eventType(document) === "conference");
    const webinars = events.filter((document) => eventType(document) === "webinar");

    const byYear = (list: ContentDocument[], ascending: boolean) => {
      const years = new Map<string, ContentDocument[]>();
      for (const document of list) {
        const year = eventDate(document).slice(0, 4);
        years.set(year, [...(years.get(year) ?? []), document]);
      }
      return [...years.entries()]
        .sort((a, b) => (ascending ? a[0].localeCompare(b[0]) : b[0].localeCompare(a[0])))
        .map(([year, group]) => ({
          events: group
            .sort((a, b) =>
              ascending ? eventDate(a).localeCompare(eventDate(b)) : eventDate(b).localeCompare(eventDate(a)),
            )
            .map(listingItem),
          year,
        }));
    };

    const webinarItems = (list: ContentDocument[], ascending: boolean) =>
      list
        .sort((a, b) =>
          ascending ? eventDate(a).localeCompare(eventDate(b)) : eventDate(b).localeCompare(eventDate(a)),
        )
        .map((document) => ({ ...listingItem(document), date: eventDate(document) }));

    const isPast = (document: ContentDocument) => eventDate(document).slice(0, 10) < today;

    return {
      past: byYear(conferences.filter(isPast), false),
      sidebar,
      upcoming: byYear(
        conferences.filter((document) => !isPast(document)),
        true,
      ),
      webinars: {
        past: webinarItems(webinars.filter(isPast), false),
        upcoming: webinarItems(
          webinars.filter((document) => !isPast(document)),
          true,
        ),
      },
    };
  };
}
