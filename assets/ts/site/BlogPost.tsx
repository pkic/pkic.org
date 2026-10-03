import { siteContentSlug } from "../../shared/site-content-slug";
import { siteContentLanguagePrefix } from "../../shared/site-content-language";
import type { SiteBlogSidebar, SiteAuthor } from "../../shared/site-content";
import type { ComponentChildren } from "preact";
import { Avatar } from "../ui/Avatar";
import { LinkList } from "../ui/LinkList";
import { AuthorStrip } from "./BlogCard";
import { LocalTime } from "./SiteDate";

/**
 * The line under a post's title: when it was published, how long it takes to
 * read, and who wrote it.
 */
export function BlogHeroMeta({ date, sidebar }: { date?: string; sidebar: SiteBlogSidebar }) {
  return (
    <>
      <p class="pk-small">
        {date ? <LocalTime value={date} /> : null}
        {date ? " • " : null}
        Reading time: <strong>{sidebar.readingTime} min</strong>
      </p>
      {sidebar.authors.length ? (
        <div class="blog-hero-authors">
          <AuthorStrip authors={sidebar.authors} />
        </div>
      ) : null}
    </>
  );
}

/**
 * One author, as `blog/author-card.html` draws them: the name and their own
 * profile links, the role they held, and the organization they held it at —
 * its mark where the byline records one, its name otherwise.
 */
function AuthorCard({ author }: { author: SiteAuthor }) {
  const organization = author.organization;
  const mark = organization?.logo ? (
    <img src={organization.logo} alt={organization.name} class="blog-author-org-logo" />
  ) : (
    organization?.name
  );
  return (
    <div class="blog-author-card">
      <Avatar name={author.name} src={author.headshot} />
      <div class="blog-author-info">
        <div class="blog-author-name-row">
          <span class="blog-author-name" data-pagefind-filter="author">
            {author.archiveHref ? <a href={author.archiveHref}>{author.name}</a> : author.name}
          </span>
          {author.links?.length ? (
            <div class="blog-author-social">
              <LinkList links={author.links} ownerName={author.name} />
            </div>
          ) : null}
        </div>
        {author.role ? <div class="blog-author-role">{author.role}</div> : null}
        {organization?.name ? (
          <div class="blog-author-org">
            {organization.website ? (
              <a href={organization.website} target="_blank" rel="noopener noreferrer" class="blog-author-org-name">
                {mark}
              </a>
            ) : (
              mark
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SidebarSection({ children, heading }: { children: preact.ComponentChildren; heading: string }) {
  return (
    <div class="blog-sidebar-section">
      <h4 class="blog-sidebar-heading">{heading}</h4>
      {children}
    </div>
  );
}

function Sidebar({ sidebar, sponsors }: { sidebar: SiteBlogSidebar; sponsors?: ComponentChildren }) {
  return (
    <div data-pagefind-ignore>
      <div class="blog-sidebar">
        <p class="blog-sidebar-reading-time">
          Reading time: <strong>{sidebar.readingTime} min</strong>
        </p>
        {sidebar.authors.length ? (
          <SidebarSection heading="Authors">
            {sidebar.authors.map((author) => (
              <AuthorCard author={author} key={author.name} />
            ))}
          </SidebarSection>
        ) : null}
        {sidebar.related.length ? (
          <SidebarSection heading="Related Articles">
            <ul class="blog-sidebar-list">
              {sidebar.related.map((post) => (
                <li key={post.href}>
                  <a href={post.href}>{post.title}</a>
                </li>
              ))}
            </ul>
          </SidebarSection>
        ) : null}
        {sidebar.tags.length ? (
          <SidebarSection heading="Related Topics">
            <div class="pk-cluster blog-sidebar-topics">
              {sidebar.tags.map((tag) => (
                <a
                  class="pk-badge pk-badge--neutral"
                  data-pagefind-filter="tag"
                  href={`${siteContentLanguagePrefix(sidebar.language ?? "en")}/tags/${siteContentSlug(tag)}/`}
                  key={tag}
                >
                  {tag}
                </a>
              ))}
            </div>
          </SidebarSection>
        ) : null}
        <div class="blog-sidebar-sponsors" data-pagefind-ignore="all">
          <p class="blog-sidebar-sponsors-intro">
            We thank our sponsors for their ongoing support of the PKI Consortium
          </p>
          {/*
            The shared sponsor display, read from D1 like every other sponsor
            surface, so a sponsorship shows here as soon as it is recorded.
          */}
          {sponsors !== undefined ? (
            sponsors
          ) : (
            <div
              data-sponsors-wall
              data-module="member-flows/sponsors-wall"
              data-api-base="/api/v1"
              data-mode="grid"
              data-rows="true"
              data-class="blog-sidebar-sponsor-logo"
            />
          )}
          <div class="blog-sidebar-sponsors-footer">
            <a href="/sponsors/" class="blog-sidebar-sponsors-all-link">
              View all sponsors →
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavArrow({ direction }: { direction: "next" | "previous" }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      fill="currentColor"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill-rule="evenodd"
        d={
          direction === "previous"
            ? "M11.354 1.646a.5.5 0 0 1 0 .708L5.707 8l5.647 5.646a.5.5 0 0 1-.708.708l-6-6a.5.5 0 0 1 0-.708l6-6a.5.5 0 0 1 .708 0z"
            : "M4.646 1.646a.5.5 0 0 1 .708 0l6 6a.5.5 0 0 1 0 .708l-6 6a.5.5 0 0 1-.708-.708L10.293 8 4.646 2.354a.5.5 0 0 1 0-.708z"
        }
      />
    </svg>
  );
}

/** Articles this old were published under the consortium's former name. */
const CASC_UNTIL = "2021-02-01";

/**
 * A blog post, in the two columns the published site gives it.
 *
 * The article reads in the wide column; beside it the sidebar carries the
 * reading time, who wrote it, where to go next and the sponsors who pay for
 * the site. The sidebar is `data-pagefind-ignore`: it is the same on every
 * post, and indexing it would drown the article's own words.
 */
export function BlogPost({
  date,
  html,
  sidebar,
  children,
  sponsors,
}: {
  date?: string;
  html?: string;
  sidebar: SiteBlogSidebar;
  children?: ComponentChildren;
  sponsors?: ComponentChildren;
}) {
  return (
    <>
      <div class="pk-section">
        <div class="pk-container">
          <div class="blog-post-layout">
            <div class="pk-stack">
              {children ? (
                <article id="content" data-pagefind-body>
                  {children}
                </article>
              ) : (
                <article id="content" data-pagefind-body dangerouslySetInnerHTML={{ __html: html ?? "" }} />
              )}
              {date && date.slice(0, 10) < CASC_UNTIL ? (
                <div class="pk-alert pk-alert--ok pk-stack pk-stack--snug" data-pagefind-ignore="all">
                  <p class="pk-alert__body">
                    This article was originally published by the "<strong>CA Security Council</strong>". In 2021 the
                    CASC was restructured and renamed to the "<strong>Public Key Infrastructure Consortium</strong>", in
                    short the "<strong>PKI Consortium</strong>".
                  </p>
                  <a href="/about/" title="About the PKI Consortium">
                    Learn more about the PKI Consortium
                  </a>
                </div>
              ) : null}
            </div>
            <Sidebar sidebar={sidebar} sponsors={sponsors} />
          </div>
        </div>
      </div>
      {sidebar.previous || sidebar.next ? (
        <div class="blog-post-nav">
          <div class="pk-container">
            <div class="blog-post-nav-inner">
              {sidebar.previous ? (
                <a class="blog-post-nav-item blog-post-nav-prev" href={sidebar.previous.href} title="Previous article">
                  <span class="blog-post-nav-label">
                    <NavArrow direction="previous" />
                    Previous article
                  </span>
                  <span class="blog-post-nav-title">{sidebar.previous.title}</span>
                </a>
              ) : (
                <div />
              )}
              {sidebar.next ? (
                <a class="blog-post-nav-item blog-post-nav-next" href={sidebar.next.href} title="Next article">
                  <span class="blog-post-nav-label">
                    Next article
                    <NavArrow direction="next" />
                  </span>
                  <span class="blog-post-nav-title">{sidebar.next.title}</span>
                </a>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
