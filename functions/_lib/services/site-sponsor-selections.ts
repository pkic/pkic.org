import type { ContentDocument } from "./site-documents";
import { conferenceDisplaySponsorSelection } from "../../../assets/shared/conference-display-policy";
import type { SiteHero } from "../../../assets/shared/site-content";
import { sponsorPublicationKey } from "../../../assets/shared/sponsor-publication-query";
import { normalizeDirectives, SHORTCODE_LEAF, parseArguments } from "./site-shortcodes";

/** Collect the public sponsor selections authored in content before the native export. */
export function collectSiteSponsorSelections(
  documents: Iterable<{ body: string; sponsor: SiteHero["sponsor"]; displaySponsor?: Record<string, string> }>,
): Array<Record<string, string>> {
  const selections = new Map<string, Record<string, string>>();
  const add = (props: Record<string, string>) => selections.set(sponsorPublicationKey(props), props);
  add({});
  for (const document of documents) {
    if (document.displaySponsor) add(document.displaySponsor);
    const sponsor = document.sponsor;
    if (sponsor)
      add({
        mode: "strip",
        ...(sponsor.eventSlug ? { eventSlug: sponsor.eventSlug } : {}),
        ...(sponsor.eventName ? { eventName: sponsor.eventName } : {}),
        minWeight: String(sponsor.minimumWeight),
      });
    for (const match of normalizeDirectives(document.body).matchAll(new RegExp(SHORTCODE_LEAF.source, "g"))) {
      if (match[1] === "sponsors" || match[1] === "sponsors-level") add(parseArguments(match[2]).props);
    }
  }
  return [...selections.values()];
}

export function collectDocumentSponsorSelections(
  documents: ContentDocument[],
  hero: (document: ContentDocument) => Pick<SiteHero, "sponsor">,
) {
  return collectSiteSponsorSelections(
    documents.map((document) => ({
      body: document.body,
      sponsor: hero(document).sponsor,
      displaySponsor: document.data.outputs?.includes("event-session")
        ? conferenceDisplaySponsorSelection(document.data.params?.sponsoring)
        : undefined,
    })),
  );
}
