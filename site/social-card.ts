import type { SiteContentPage } from "../assets/shared/site-content";
import type { PublicMemberDetail } from "../assets/shared/schemas/members-directory";
import type { SitePublicationSnapshot } from "../assets/shared/schemas/site-publication";
import { sponsorPublicationKey } from "../assets/shared/sponsor-publication-query";
import { INDIVIDUAL_MEMBERSHIP_CATEGORIES } from "../assets/shared/schemas/membership-categories";

/** Publication-only projection; every person and organization is already public. */
export function socialCardDescriptor({
  route,
  title,
  description,
  content,
  member,
  publication,
}: {
  route: string;
  title: string;
  description?: string;
  content?: Pick<SiteContentPage, "workingGroup" | "hero" | "taxonomy" | "blog" | "socialCard" | "pageAccent" | "meta">;
  member?: PublicMemberDetail;
  publication: SitePublicationSnapshot;
}) {
  const wgId = content?.workingGroup?.wgId ?? content?.hero.wgId;
  const group = wgId ? publication.groups[wgId.toLowerCase()] : undefined;
  const author =
    content?.taxonomy?.plural === "authors" && content.taxonomy.term
      ? content.taxonomy.posts
          ?.flatMap((post) => post.authors ?? [])
          .find((person) => person.name === content.taxonomy?.term)
      : undefined;
  const individual = member && INDIVIDUAL_MEMBERSHIP_CATEGORIES.has(member.memberType);
  const kind = member
    ? "member"
    : wgId
      ? "working-group"
      : route === "/" || route === "/members/" || route === "/members/independent/"
        ? "community"
        : author
          ? "author"
          : content?.blog
            ? "article"
            : content?.socialCard?.variant === "webinar"
              ? "webinar"
              : route.startsWith("/events/") && route !== "/events/"
                ? "event"
                : "page";
  const sponsors =
    content?.hero.sponsor?.publishedSponsors ??
    (publication.sponsors[sponsorPublicationKey({})] ?? []).flatMap((entry) => entry.sponsors);
  const webinarSponsor = content?.socialCard?.sponsorSlug
    ? publication.members.find((entry) => entry.slug === content.socialCard?.sponsorSlug)
    : undefined;
  return {
    route,
    kind,
    title: content?.workingGroup && content.workingGroup.section !== "about" ? title : (content?.hero.title ?? title),
    description:
      member?.slogan ??
      (author ? [author.role, author.organization?.name].filter(Boolean).join(" · ") : undefined) ??
      content?.hero.descriptionHtml ??
      content?.hero.description ??
      description ??
      "",
    label: member
      ? individual
        ? "Community member"
        : "Member organization"
      : kind === "webinar"
        ? "Sponsored webinar"
        : (content?.hero.eyebrow ??
          {
            member: "Member organization",
            author: "Author",
            webinar: "Sponsored webinar",
            community: "Our community",
            article: "Insights",
            event: "Events",
            "working-group": "Working group",
            page: "PKI Consortium",
          }[kind] ??
          "PKI Consortium"),
    accent: content?.pageAccent ?? content?.hero.tone ?? "green",
    hero: content?.hero.imageSrc,
    visual: member?.logoUrl ?? content?.socialCard?.imageSrc ?? author?.headshot ?? webinarSponsor?.logoUrl,
    visualRound: Boolean(member ? individual : author?.headshot || content?.socialCard?.imageRound),
    authors: content?.blog?.authors.map((author) => ({ name: author.name, photo: author.headshot })) ?? [],
    leaders:
      group?.leadership.slice(0, 2).map(({ person, title }) => ({
        name: person.name,
        title,
        photo: person.photoUrl,
        organization: person.organizationName,
      })) ?? [],
    logos: (wgId ? (publication.groupMembers[wgId.toLowerCase()] ?? []) : publication.memberWall)
      .filter((entry) => entry.logoUrl)
      .slice(0, 8)
      .map((entry) => ({ name: entry.name, src: entry.logoUrl })),
    sponsors: sponsors
      .filter((entry) => entry.weight >= 5 && entry.logoUrl)
      .slice(0, 4)
      .map((entry) => ({ name: entry.name, src: entry.logoUrl })),
    date: content?.blog ? content.meta?.date : undefined,
  };
}
