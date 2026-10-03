import { sponsorPublicationKey } from "../../shared/sponsor-publication-query";
import { SponsorGridView } from "./SponsorDisplays";
import type { SiteContentPage } from "../../shared/site-content";
import type { SitePublicationSnapshot } from "../../shared/schemas/site-publication";
import { ContentPage, HomePage } from "./SitePages";
import { BlogHeroMeta, BlogPost } from "./BlogPost";
import { SiteHero } from "./SitePrimitives";
import { EventsIndex } from "./EventsIndex";
import { TaxonomyPage } from "./TaxonomyPage";
import { WorkingGroupContentPage, WorkingGroupLandingPage, WorkingGroupSectionPage } from "./WorkingGroupSection";

/** Shared page composition for framework publication and the remaining Worker routes. */
export function SitePageBody({
  content,
  publication,
  memberCount,
}: {
  content: SiteContentPage;
  publication?: SitePublicationSnapshot;
  memberCount?: number;
}) {
  if (content.home) return <HomePage hero={content.hero} home={{ ...content.home, memberCount }} html={content.html} />;
  if (content.workingGroup?.section === "about")
    return (
      <WorkingGroupLandingPage
        hero={content.hero}
        section={content.workingGroup}
        staticPublication={Boolean(publication)}
        publishedDirectory={publication?.groups[content.workingGroup.wgId.toLowerCase()]}
      />
    );
  if (content.events)
    return (
      <>
        <SiteHero hero={content.hero} />
        <EventsIndex events={content.events} html={content.html} />
      </>
    );
  if (content.taxonomy) return <TaxonomyPage taxonomy={content.taxonomy} />;
  if (content.blog)
    return (
      <>
        <SiteHero hero={content.hero}>
          <BlogHeroMeta date={content.meta?.date} sidebar={content.blog} />
        </SiteHero>
        <BlogPost
          date={content.meta?.date}
          html={content.html}
          sidebar={content.blog}
          sponsors={
            publication ? (
              <SponsorGridView
                display={{ groups: publication.sponsors[sponsorPublicationKey({})] ?? [] }}
                rows
                logoClass="blog-sidebar-sponsor-logo"
              />
            ) : undefined
          }
        />
      </>
    );
  if (content.workingGroup?.section === "content")
    return <WorkingGroupContentPage html={content.html} section={content.workingGroup} />;
  if (content.workingGroup)
    return (
      <WorkingGroupSectionPage
        section={content.workingGroup}
        publishedMembers={
          publication ? (publication.groupMembers[content.workingGroup.wgId.toLowerCase()] ?? []) : undefined
        }
      />
    );
  return (
    <ContentPage
      fullwidth={content.fullwidth}
      hero={content.hero}
      html={content.html}
      island={content.island}
      listing={content.listing}
      meta={content.meta}
      sectionNavigation={content.sectionNavigation}
    >
      {content.webinarSponsor ? (
        <aside class="pk-webinar-sponsor-notice" aria-label="Sponsored webinar">
          {content.webinarSponsor.logoSrc ? (
            <img src={content.webinarSponsor.logoSrc} alt={content.webinarSponsor.name} loading="lazy" />
          ) : null}
          <p>
            This is a sponsored webinar hosted by the PKI Consortium to help fund our activities and keep membership
            accessible. The content is produced and presented by <strong>{content.webinarSponsor.name}</strong> and is
            the sole responsibility of the sponsoring organization.{" "}
            <strong>This webinar is not endorsed by the PKI Consortium or its members.</strong>
          </p>
        </aside>
      ) : null}
    </ContentPage>
  );
}
