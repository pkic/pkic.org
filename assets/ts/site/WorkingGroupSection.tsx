import { Fragment } from "preact";

import type { SiteHero, SiteWorkingGroupCard, SiteWorkingGroupSection } from "../../shared/site-content";
import { ButtonLink } from "../ui/Button";
import { BlogCard } from "./BlogCard";
import { EventCard } from "./EventCard.tsx";
import { SiteHero as PageHero } from "./SitePrimitives";
import { WorkingGroupIcon } from "./WorkingGroupIcon.tsx";
import { WorkingGroupSidebar, WorkingGroupSidebarTree } from "./WorkingGroupSidebar.tsx";
import type { GroupDirectoryResponse } from "../../shared/schemas/group-directory";
import { GroupChairsView } from "./GroupChairs";
import { DirectoryGrid, type DirectoryMember } from "./MemberDirectory";

import "./WorkingGroupSection.css";

function statusTone(status?: string): string {
  if (status === "planned") return "warn";
  if (status === "completed") return "info";
  return "ok";
}

/**
 * A card in one of the data-driven sections.
 *
 * The published markup is the bento card, whose stylesheet the group's colour
 * tints; the status badge and the footer link are its own parts.
 */
function BentoCard({ accent, card }: { accent: string; card: SiteWorkingGroupCard }) {
  const body = (
    <>
      {card.icon ? (
        <div class="pk-cluster pk-cluster--start">
          <span class="bento-icon" aria-hidden="true">
            {card.icon}
          </span>
          <div class="bento-title">{card.title}</div>
        </div>
      ) : (
        <>
          {card.status ? (
            <span class={`bento-badge bento-badge--${statusTone(card.status)}`}>{card.status}</span>
          ) : null}
          <div class="bento-title">{card.title}</div>
        </>
      )}
      {card.description ? <div class="bento-text">{card.description}</div> : null}
    </>
  );
  if (!card.href) return <div class={`bento-card bento-${accent}-pale`}>{body}</div>;
  return (
    <a
      class={`bento-card bento-card-link bento-${accent}-pale`}
      href={card.href}
      rel={card.external ? "noopener noreferrer" : undefined}
      target={card.external ? "_blank" : undefined}
    >
      {body}
      <div class="bento-footer pk-strong">
        {card.external ? "Visit ↗" : "Explore →"}
        {card.external ? <span class="pk-sr-only"> (opens in a new site)</span> : null}
      </div>
    </a>
  );
}

/**
 * The sticky section nav.
 *
 * `global-ui.js` opens the tree disclosures and `wg-nav.js` runs the scroll
 * spy on the landing page, so the markup keeps the published class names and
 * the `data-target` contract they read.
 */
function SectionNav({ section }: { section: SiteWorkingGroupSection }) {
  return (
    <nav class={`wg-section-nav wg-${section.wgId.toLowerCase()}`} id="wgSectionNav" aria-label="Page sections">
      <div class="pk-container pk-cluster pk-cluster--nowrap">
        {section.nav.map((item) => {
          const link = (
            <a
              class={`wg-nav-link${item.current ? " is-active" : ""}`}
              href={item.href}
              aria-current={item.current ? "page" : undefined}
              data-target={item.target}
            >
              {item.label}
            </a>
          );
          // A deliverable with pages under it gets the chevron that opens its
          // tree; everything else is the link on its own.
          return item.panel ? (
            <div class="wg-nav-link-wrap" data-panel={item.panel} key={item.href}>
              {link}
              <button
                class="wg-nav-more-btn"
                type="button"
                data-wg-tree-btn
                aria-expanded="false"
                aria-label="Show contents"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </div>
          ) : (
            <Fragment key={item.href}>{link}</Fragment>
          );
        })}
      </div>
    </nav>
  );
}

/** The panels the section nav's chevrons open, hidden until one is asked for. */
function TreePanels({ section }: { section: SiteWorkingGroupSection }) {
  if (!section.treePanels?.length) return null;
  return (
    <>
      {section.treePanels.map((panel) => (
        <div class={`wg-nav-tree-panel wg-${section.wgId.toLowerCase()}`} id={panel.id} key={panel.id} hidden>
          <WorkingGroupSidebarTree tree={panel.tree} />
          {panel.versions ? (
            <div class="wg-version-switcher">
              <p class="wg-version-eyebrow">Switch version</p>
              <div class="wg-version-list" role="group" aria-label="Switch PKIMM model version">
                {panel.versions.map((version) => (
                  <a
                    key={version.id}
                    class={`wg-version-item${version.current ? " is-active" : ""}`}
                    href={version.href}
                    aria-current={version.current ? "page" : undefined}
                  >
                    <span class="wg-version-badge">{version.label}</span>
                    {version.latest ? <span class="wg-version-hint">Latest release</span> : null}
                    {version.fallback ? (
                      <span
                        class="wg-version-hint wg-version-hint--fallback"
                        title={`This page is not available in ${version.label} — go to the version overview instead`}
                      >
                        Overview
                      </span>
                    ) : null}
                  </a>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ))}
    </>
  );
}

function SubPageHeader({ section }: { section: SiteWorkingGroupSection }) {
  return (
    <div class={`wg-sub-header wg-${section.wgId.toLowerCase()}`}>
      <WorkingGroupIcon className="wg-sub-header-watermark" name={section.wgId.toLowerCase()} />
      <div class="pk-container">
        <p class="wg-sub-eyebrow">
          {section.breadcrumb.map((crumb, index) => (
            <>
              {index > 0 ? <span aria-hidden="true">›</span> : null}
              <a href={crumb.href} key={crumb.href}>
                {crumb.label}
              </a>
            </>
          ))}
        </p>
        <h1 class="wg-sub-title">{section.title}</h1>
        {section.description ? <p class="wg-sub-desc">{section.description}</p> : null}
      </div>
    </div>
  );
}

function JoinCta({ section }: { section: SiteWorkingGroupSection }) {
  return (
    <section class="pk-section wg-alt-section">
      <div class="pk-container pk-center wg-page-actions">
        {section.join ? (
          <ButtonLink href={section.join.href} size="lg" variant="primary">
            {section.join.label}
          </ButtonLink>
        ) : null}
        <ButtonLink href={section.base} size="sm" variant="secondary">
          ← Back to {section.groupTitle}
        </ButtonLink>
      </div>
    </section>
  );
}

/** The conferences page's two bands, each its own section with its own heading. */
function ConferenceBands({ section }: { section: SiteWorkingGroupSection }) {
  const bands = [
    { heading: "Upcoming Conferences", id: "wg-conferences-upcoming", items: section.conferences?.upcoming ?? [] },
    { heading: "Past Conferences", id: "wg-conferences-past", items: section.conferences?.past ?? [] },
  ].filter((band) => band.items.length);
  return (
    <>
      {bands.map((band) => (
        <section class="pk-section" id={band.id} key={band.id}>
          <div class="pk-container pk-stack">
            <h2 class="pk-strong">{band.heading}</h2>
            <div class="pk-grid">
              {band.items.map((item) => (
                <div key={item.href}>
                  <EventCard item={item} upcoming={band.id.endsWith("upcoming")} />
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

function SectionBody({
  section,
  publishedMembers,
}: {
  section: SiteWorkingGroupSection;
  publishedMembers?: DirectoryMember[];
}) {
  if (section.section === "blog") {
    return section.posts?.length ? (
      <div class="pk-grid pk-grid--roomy">
        {section.posts.map((post) => (
          <BlogCard item={post} key={post.href} />
        ))}
      </div>
    ) : (
      <p class="pk-muted">
        No blog posts yet for this working group. <a href="/blog/">Visit our blog</a> for the latest news.
      </p>
    );
  }
  if (section.section === "members") {
    if (publishedMembers) return <DirectoryGrid members={publishedMembers} prefix="wg" />;
    // The group's own member grid: who is in the room, not the full directory.
    return (
      <div
        data-group-member-grid
        data-module="member-flows/member-directory-page"
        data-api-base="/api/v1"
        data-working-group={section.wgId.toLowerCase()}
      />
    );
  }
  return section.cards.length ? (
    <div class="bento-grid">
      {section.cards.map((card) => (
        <BentoCard accent={section.accent} card={card} key={card.title} />
      ))}
    </div>
  ) : null;
}

/** One of a group's generated sub-pages: focus, deliverables, members, resources, blog. */
export function WorkingGroupSectionPage({
  section,
  publishedMembers,
}: {
  section: SiteWorkingGroupSection;
  publishedMembers?: DirectoryMember[];
}) {
  return (
    <>
      <SubPageHeader section={section} />
      <SectionNav section={section} />
      <TreePanels section={section} />
      <div class="wg-data-body" data-pagefind-body>
        {section.section === "conferences" ? (
          <ConferenceBands section={section} />
        ) : (
          <section class="pk-section">
            <div class="pk-container pk-stack">
              <h2 class="pk-strong">{section.heading}</h2>
              <p class="pk-muted">{section.lead}</p>
              <SectionBody section={section} publishedMembers={publishedMembers} />
            </div>
          </section>
        )}
        <JoinCta section={section} />
      </div>
    </>
  );
}

/**
 * A working group's landing page.
 *
 * Its hero is the shared page hero; everything below it is the group's own
 * front matter: the intro beside the chair roster and the join button, the
 * headline deliverables, and the grid that leads into the generated sections.
 */
export function WorkingGroupLandingPage({
  hero,
  section,
  publishedDirectory,
  staticPublication = false,
}: {
  hero: SiteHero;
  section: SiteWorkingGroupSection;
  publishedDirectory?: GroupDirectoryResponse;
  staticPublication?: boolean;
}) {
  const accent = section.accent;
  const slug = section.wgId.toLowerCase();
  return (
    <>
      <PageHero hero={hero} />
      <div class={`wg-hero-strip wg-${slug}`} />
      <SectionNav section={section} />
      <TreePanels section={section} />

      {section.introHtml ? (
        <section class="pk-section" id="wg-about">
          <div class="pk-container pk-stack">
            <div class="wg-intro-layout">
              {/*
                The intro column carries no class of its own: `wg/section.html`
                leaves it bare so the body reads at the page's own scale, and a
                prose class here would repaint its colour and its leading.
              */}
              <div data-pagefind-body dangerouslySetInnerHTML={{ __html: section.introHtml }} />
              <div>
                {publishedDirectory || staticPublication ? (
                  <GroupChairsView
                    leaders={publishedDirectory?.leadership ?? []}
                    wgLabel={section.wgId}
                    mode="compact"
                  />
                ) : (
                  <div
                    data-wg-chairs
                    data-module="member-flows/wg-chairs-widget"
                    data-api-base="/api/v1"
                    data-wg-slug={slug}
                    data-wg-label={section.wgId}
                  />
                )}
                {section.join ? (
                  <div class="pk-center wg-join">
                    <ButtonLink href={section.join.href} size="lg" variant="primary">
                      {section.join.label}
                    </ButtonLink>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {section.keyDeliverables?.length ? (
        <section class="wg-key-deliverables pk-section" id="wg-key-deliverables">
          <div class="pk-container pk-center">
            <div>
              <p class="wg-key-eyebrow">Key Deliverables</p>
            </div>
            <div class="pk-grid pk-grid--roomy">
              {section.keyDeliverables.map((deliverable) => (
                <div key={deliverable.title}>
                  <div class={`wg-key-card wg-key-card--${accent}`}>
                    {deliverable.badge ? <span class="wg-key-badge">{deliverable.badge}</span> : null}
                    <div class="wg-key-icon">
                      <WorkingGroupIcon className="wg-key-svg" name={deliverable.icon} />
                    </div>
                    <h3 class="wg-key-title">{deliverable.title}</h3>
                    <p class="wg-key-desc">{deliverable.description}</p>
                    {deliverable.href ? (
                      <a href={deliverable.href} class="wg-key-cta">
                        {deliverable.cta} →
                      </a>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {section.explore?.length ? (
        <section class="pk-section wg-alt-section" id="wg-explore">
          <div class="pk-container pk-stack">
            <h2 class="pk-strong">Explore this Working Group</h2>
            <p class="pk-muted">Select a section to dive deeper</p>
            <div class="pk-grid">
              {section.explore.map((card) => (
                <div key={card.href}>
                  <a href={card.href} class={`wg-explore-card wg-explore-card--${accent}`}>
                    <div class="wg-explore-icon">{card.icon}</div>
                    <div class="wg-explore-title">{card.title}</div>
                    <div class="wg-explore-desc">{card.count}</div>
                    <div class="wg-explore-arrow pk-push-block">Explore →</div>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : null}
    </>
  );
}

/**
 * A page a working group authors itself: a charter, a deliverable, or one of
 * the pages below it.
 *
 * Hugo rendered these through `partials/wg/sub-navigation.html`, which is why
 * they carry the group's header and section nav rather than the generic
 * article chrome. A page that asks for a side menu reads in two columns with
 * the section tree beside it; the rest read as a single prose column.
 */
export function WorkingGroupContentPage({ html, section }: { html: string; section: SiteWorkingGroupSection }) {
  const body = <div class="wg-main-content" data-pagefind-body dangerouslySetInnerHTML={{ __html: html }} />;
  return (
    <>
      <SubPageHeader section={section} />
      <SectionNav section={section} />
      <TreePanels section={section} />
      <div class="pk-container pk-section">
        {section.sidebar ? (
          <div class="wg-layout">
            <WorkingGroupSidebar tree={section.sidebar} wgId={section.wgId} />
            {body}
          </div>
        ) : (
          <div class="wg-prose" data-pagefind-body dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </>
  );
}
