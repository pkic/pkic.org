import type { ModelVersionNavigationData } from "../../shared/model-versions";
import { SiteImage } from "./SiteImage";
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
  modelVersions,
}: {
  content: SiteContentPage;
  publication?: SitePublicationSnapshot;
  memberCount?: number;
  modelVersions?: ModelVersionNavigationData;
}) {
  const group = content.workingGroup;
  const decorateTree = (tree: NonNullable<typeof group>["sidebar"]) =>
    tree && modelVersions && tree.root.href.startsWith(modelVersions.root)
      ? {
          ...tree,
          versions: {
            label: modelVersions.label,
            items: modelVersions.items.map((item) => ({
              ...item,
              current: item.id === modelVersions.activeId,
              latest: item.id === modelVersions.latestId,
            })),
          },
        }
      : tree;
  const workingGroup = group
    ? {
        ...group,
        sidebar: decorateTree(group.sidebar),
        treePanels: group.treePanels?.map((panel) => ({ ...panel, tree: decorateTree(panel.tree)! })),
      }
    : undefined;
  if (content.home) return <HomePage hero={content.hero} home={{ ...content.home, memberCount }} html={content.html} />;
  if (workingGroup?.section === "about")
    return (
      <WorkingGroupLandingPage
        hero={content.hero}
        section={workingGroup}
        staticPublication={Boolean(publication)}
        publishedDirectory={publication?.groups[workingGroup.wgId.toLowerCase()]}
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
  if (workingGroup?.section === "content")
    return <WorkingGroupContentPage html={content.html} section={workingGroup} />;
  if (workingGroup)
    return (
      <WorkingGroupSectionPage
        section={workingGroup}
        publishedMembers={publication ? (publication.groupMembers[workingGroup.wgId.toLowerCase()] ?? []) : undefined}
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
            <SiteImage src={content.webinarSponsor.logoSrc} alt={content.webinarSponsor.name} loading="lazy" />
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
