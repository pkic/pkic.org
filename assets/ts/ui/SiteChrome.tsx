import { MemberWallView } from "../site/SponsorDisplays";
import type { MemberWallEntry } from "../../shared/schemas/members-directory";
import type { ComponentChildren } from "preact";
import type { SiteNavigation, SiteNavigationItem } from "../../shared/site-content";
import { WorkingGroupIcon } from "../site/WorkingGroupIcon.tsx";
import { IconChevron, IconMenu, IconRemove, IconSearch } from "./MediaIcons";
import { ThemeToggle } from "./ThemeToggle";

import "./SiteChrome.css";

/** Hugo's `truncate`: cut on a word boundary and mark the cut. */
function truncate(value: string | undefined, limit: number): string | undefined {
  if (!value || value.length <= limit) return value;
  const cut = value.slice(0, limit);
  const boundary = cut.lastIndexOf(" ");
  return `${(boundary > 0 ? cut.slice(0, boundary) : cut).replace(/[\s.,;:]+$/, "")} …`;
}

/**
 * Hugo's `IsMenuCurrent`: the entry for the page you are on, and no other.
 *
 * A prefix match lit "Working Groups" on every page under `/wg/` and "Events"
 * on every page under `/events/`, which the published bar does not do — the
 * section's own nav says where you are once you are inside it.
 */
function pathIsActive(currentPath: string, href?: string): boolean {
  return Boolean(href?.startsWith("/")) && currentPath === href;
}

function NavigationLink({ currentPath, item }: { currentPath: string; item: SiteNavigationItem }) {
  if (!item.href) return <span class="pkic-nav-link">{item.label}</span>;
  const active = pathIsActive(currentPath, item.href);
  return (
    <a
      // `aria-current` alongside the class: the published bar marked the
      // current section visually only, which leaves a screen reader without
      // the one fact the highlight carries.
      aria-current={active ? "page" : undefined}
      class={`pkic-nav-link${active ? " is-active" : ""}`}
      href={item.href}
      title={item.label}
      rel={item.external ? "noopener noreferrer" : undefined}
      target={item.external ? "_blank" : undefined}
    >
      {item.label}
      {item.external ? <span class="pk-sr-only"> (opens in a new site)</span> : null}
    </a>
  );
}

/** A top-level item that opens one of the mega panels. */
function MegaTrigger({
  currentPath,
  extraClass,
  item,
  target,
}: {
  currentPath: string;
  extraClass?: string;
  item: SiteNavigationItem;
  target: string;
}) {
  return (
    <div class={`pkic-mega-trigger${extraClass ? ` ${extraClass}` : ""}`}>
      <NavigationLink currentPath={currentPath} item={item} />
      <button
        class="pkic-mega-chevron"
        data-mega-target={target}
        aria-label={`Open ${item.label} menu`}
        aria-expanded="false"
        type="button"
      >
        <IconChevron pointing="down" width="11" height="11" />
      </button>
    </div>
  );
}

function SearchTrigger({ id, withLabel = true }: { id: string; withLabel?: boolean }) {
  return (
    <button class="pkic-search-trigger" id={id} type="button" aria-label="Open search">
      <IconSearch width="13" height="13" />
      {withLabel ? <span class="pkic-search-trigger-label">Search…</span> : <span>Search…</span>}
      {withLabel ? (
        <kbd class="pkic-search-shortcut" id="pkicSearchKbd">
          ⌘K
        </kbd>
      ) : null}
    </button>
  );
}

function WorkingGroupsPanel({ groups }: { groups: SiteNavigationItem[] }) {
  return (
    <div class="pkic-mega-panel" id="pkic-wg-mega" aria-label="Working Groups navigation">
      <div class="pk-container pk-container--wide pkic-mega-body pk-stack pk-stack--snug">
        <p class="pkic-mega-label">Working Groups</p>
        <div class="pk-grid pk-grid--roomy">
          {groups.map((group) => (
            <a
              class={`pkic-mega-wg-card pkic-mega-wg-card--${group.card?.color ?? "green"}`}
              href={group.href}
              key={group.identifier}
            >
              <span class="pkic-mega-icon">
                <WorkingGroupIcon className="pkic-mega-wg-svg" name={group.card?.icon} />
              </span>
              <div class="pkic-mega-card-body">
                <div class="pkic-mega-wg-id">{group.card?.wgId}</div>
                <div class="pkic-mega-wg-name">{group.card?.title ?? group.label}</div>
                <p class="pkic-mega-wg-desc">{truncate(group.card?.description, 90)}</p>
              </div>
              <span class="pkic-mega-arrow" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </div>
        <div class="pkic-mega-footer">
          <a href="/wg/" class="pkic-mega-footer-link">
            View all Working Groups →
          </a>
        </div>
      </div>
    </div>
  );
}

const MEMBER_ACTIONS = [
  { desc: "Become part of our global network", href: "/join/", icon: "🤝", title: "Join the PKI Consortium" },
  { desc: "Learn how membership works", href: "/application-process/", icon: "📋", title: "Application Process" },
  { desc: "How decisions are made", href: "/bylaws/", icon: "📄", title: "Bylaws & Governance" },
];

function MembersPanel({ counts }: { counts?: { organization: number; independent: number } }) {
  return (
    <div class="pkic-mega-panel pkic-members-mega-panel" id="pkic-members-mega" aria-label="Members navigation">
      <div class="pk-container pk-container--wide pkic-mega-body">
        <div class="pk-grid pk-grid--roomy">
          <div class="pk-stack pk-stack--snug">
            <p class="pkic-mega-label">Members</p>
            <p class="pk-small">
              The PKI Consortium brings together leading organizations committed to trustworthy digital identities and
              secure communication.
            </p>
            <div class="pk-cluster">
              <a href="/members/" class="pkic-members-stat-card">
                <span
                  class="pkic-members-stat-num"
                  data-member-count={counts ? undefined : "organization"}
                  aria-live="polite"
                >
                  {counts?.organization ?? "—"}
                </span>
                <span class="pkic-members-stat-label">Members</span>
              </a>
              <a href="/members/independent/" class="pkic-members-stat-card pkic-members-stat-card--indep">
                <span
                  class="pkic-members-stat-num"
                  data-member-count={counts ? undefined : "independent"}
                  aria-live="polite"
                >
                  {counts?.independent ?? "—"}
                </span>
                <span class="pkic-members-stat-label">Independent</span>
              </a>
            </div>
            <a href="/members/" class="pkic-mega-footer-link">
              Browse all members →
            </a>
          </div>
          <div class="pk-stack pk-stack--snug">
            <p class="pkic-mega-label">Quick links</p>
            {MEMBER_ACTIONS.map((action) => (
              <a href={action.href} class="pkic-members-action-link" key={action.href}>
                <span class="pkic-members-action-icon" aria-hidden="true">
                  {action.icon}
                </span>
                <div>
                  <div class="pkic-members-action-title">{action.title}</div>
                  <div class="pkic-members-action-desc">{action.desc}</div>
                </div>
                <span class="pkic-mega-arrow pk-push" aria-hidden="true">
                  →
                </span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const SEARCH_FILTERS = [
  { label: "All", type: "" },
  { label: "Blog", type: "blog" },
  { label: "Events", type: "events" },
  { label: "Working Groups", type: "wg" },
  { label: "Members", type: "members" },
];

function SearchPanel() {
  return (
    <>
      <div id="pkicSearchBackdrop" aria-hidden="true" />
      <div class="pkic-search-panel" id="pkicSearchPanel" hidden aria-label="Search results">
        <div class="pk-container pk-container--wide pkic-search-panel-body">
          <div class="pkic-search-panel-mobile-input">
            <div class="pkic-search-input-wrap pkic-search-panel-input">
              <IconSearch class="pkic-search-input-icon" width="13" height="13" />
              <input
                type="search"
                id="pkicSearchInputMobile"
                class="pkic-search-input-field"
                placeholder="Search…"
                autocomplete="off"
                spellcheck={false}
                aria-label="Search"
              />
            </div>
          </div>
          <div class="pkic-search-filters" id="pkicSearchFilters">
            {SEARCH_FILTERS.map((filter, index) => (
              <button
                class={`pkic-filter-pill${index === 0 ? " is-active" : ""}`}
                type="button"
                data-type={filter.type}
                key={filter.label}
              >
                {filter.label}
              </button>
            ))}
            <button
              class="pkic-search-panel-close pk-push"
              id="pkicSearchPanelClose"
              type="button"
              aria-label="Close search"
            >
              <IconRemove width="18" height="18" />
              <span>Close search</span>
              <kbd>Esc</kbd>
            </button>
          </div>
          <div class="pkic-search-layout">
            <aside class="pkic-search-sidebar" id="pkicSearchSubfilters" hidden />
            <div class="pkic-search-main">
              <div id="pkicSearchResults">
                <p class="pkic-search-hint">Start typing to search across all content…</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export function SiteHeader({
  currentPath,
  navigation,
  memberCounts,
}: {
  currentPath: string;
  navigation: SiteNavigation;
  memberCounts?: { organization: number; independent: number };
}) {
  const workingGroups = navigation.main.find((item) => item.children.length)?.children ?? [];
  return (
    <>
      <nav class="pkic-navbar" id="pkicMainNav" aria-label="Main">
        <div class="pk-container pk-container--wide pkic-navbar-container">
          <a href="/" class="pkic-navbar-brand" aria-label="PKI Consortium home">
            <img src="/img/logo.svg" width="1256" height="324" alt="PKI Consortium" />
          </a>

          <div class="pkic-navbar-search" id="pkicNavSearch">
            <SearchTrigger id="pkicSearchToggle" />
            <div class="pkic-search-input-wrap" id="pkicSearchInputWrap">
              <IconSearch class="pkic-search-input-icon" width="13" height="13" />
              <input
                type="search"
                id="pkicSearchInput"
                class="pkic-search-input-field"
                placeholder="Search…"
                autocomplete="off"
                spellcheck={false}
                aria-label="Search"
              />
              <button class="pkic-search-close-btn" id="pkicSearchClose" type="button" aria-label="Close search">
                <IconRemove width="14" height="14" />
              </button>
            </div>
          </div>

          {/*
            Controls that act on the site rather than navigate it. Outside the
            link list and outside the collapse, so they read as chrome and stay
            reachable on a phone.
          */}
          <div class="pkic-navbar-utilities">
            <div class="pkic-navbar-quick-search">
              <SearchTrigger id="pkicSearchToggleQuick" withLabel={false} />
            </div>
            <ThemeToggle />
          </div>

          <button
            class="pkic-navbar-toggler"
            type="button"
            id="pkicNavToggle"
            aria-controls="navbarContent"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <IconMenu width="24" height="24" />
          </button>

          <div class="pkic-navbar-collapse" id="navbarContent">
            <div class="pkic-navbar-mobile-search" id="pkicNavSearchMobile">
              <SearchTrigger id="pkicSearchToggleMobile" withLabel={false} />
            </div>
            <div class="pkic-navbar-nav" id="pkicNavItems">
              {navigation.main.map((item) =>
                item.children.length ? (
                  <MegaTrigger currentPath={currentPath} item={item} key={item.identifier} target="pkic-wg-mega" />
                ) : item.identifier === "members" ? (
                  <MegaTrigger
                    currentPath={currentPath}
                    extraClass="pkic-members-trigger"
                    item={item}
                    key={item.identifier}
                    target="pkic-members-mega"
                  />
                ) : (
                  <NavigationLink currentPath={currentPath} item={item} key={item.identifier} />
                ),
              )}
            </div>
          </div>
        </div>
      </nav>

      <SearchPanel />
      <WorkingGroupsPanel groups={workingGroups} />
      <div class="pkic-mega-backdrop" id="pkicMegaBackdrop" />
      <MembersPanel counts={memberCounts} />
    </>
  );
}

export function SiteMain({ children, privatePage }: { children: ComponentChildren; privatePage?: boolean }) {
  return <main data-pagefind-ignore={privatePage ? "all" : undefined}>{children}</main>;
}

const SOCIAL_LINKS = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/pki-consortium/",
    path: "M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854V1.146zm4.943 12.248V6.169H2.542v7.225h2.401zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248-.822 0-1.359.54-1.359 1.248 0 .694.521 1.248 1.327 1.248h.016zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016a5.54 5.54 0 0 1 .016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225h2.4z",
  },
  {
    label: "X",
    href: "https://x.com/PKIConsortium",
    path: "M12.6.75h2.454l-5.36 6.142L16 15.25h-4.937l-3.867-5.07-4.425 5.07H.316l5.733-6.57L0 .75h5.063l3.495 4.633L12.601.75Zm-.86 13.028h1.36L4.323 2.145H2.865z",
  },
  {
    label: "GitHub",
    href: "https://github.com/pkic",
    path: "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z",
  },
];

/**
 * The member-logo marquee that runs above the footer.
 *
 * Public chrome only: on the portal a strip of logos under the content reads
 * as clutter, which is why Hugo skipped it there too.
 */
function FooterMemberWall({ entries }: { entries?: MemberWallEntry[] }) {
  return (
    <div class="pk-container members footer-member-wall pk-center">
      <div class="banner">
        {entries !== undefined ? (
          <div data-published-member-wall>
            <MemberWallView entries={entries} />
          </div>
        ) : (
          <div
            data-sponsors-wall
            data-module="member-flows/sponsors-wall"
            data-api-base="/api/v1"
            data-mode="wall"
            data-member-limit="999999"
          />
        )}
      </div>
    </div>
  );
}

export function SiteFooter({
  navigation,
  privatePage,
  memberWall,
  copyrightYear = new Date().getUTCFullYear(),
}: {
  navigation: SiteNavigation;
  privatePage?: boolean;
  memberWall?: MemberWallEntry[];
  copyrightYear?: number;
}) {
  return (
    <>
      {privatePage ? null : <FooterMemberWall entries={memberWall} />}
      <footer id="site-footer">
        <div id="participate">
          <div class="pk-container">
            Participate in our{" "}
            <a href="https://github.com/orgs/pkic/discussions" target="_blank" rel="noopener noreferrer">
              community
            </a>{" "}
            discussions, <a href="/join/">join</a> the consortium, and{" "}
            <a href="/donate/" class="footer-cta-donate">
              support us with a donation
            </a>
          </div>
        </div>

        <div class="footer-body">
          <div class="pk-container">
            <div class="pk-grid footer-columns">
              <div class="footer-brand pk-stack pk-stack--snug">
                <a href="/" class="footer-logo-link" aria-label="PKI Consortium home">
                  <img src="/img/logo.svg" width="1256" height="324" alt="PKI Consortium" class="footer-logo-img" />
                </a>
                <p class="footer-tagline">Trusted digital assets and communication for everyone and everything</p>
                <div class="footer-social">
                  {SOCIAL_LINKS.map((social) => (
                    <a
                      href={social.href}
                      target="_blank"
                      class="linkArea"
                      rel="noopener noreferrer"
                      title={social.label}
                      aria-label={social.label}
                      key={social.label}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        fill="currentColor"
                        viewBox="0 0 16 16"
                        aria-hidden="true"
                        focusable="false"
                      >
                        <path d={social.path} />
                      </svg>
                    </a>
                  ))}
                </div>
              </div>

              {navigation.footer.map((column) =>
                column.children.length ? (
                  <div class="pk-stack pk-stack--snug" key={column.identifier}>
                    <h2 class="footer-col-title">{column.label}</h2>
                    <ul class="footer-col-list">
                      {column.children.map((item) => (
                        <li key={item.identifier}>
                          <a
                            href={item.href}
                            class="footer-col-link"
                            rel={item.external ? "noopener noreferrer" : undefined}
                            target={item.external ? "_blank" : undefined}
                          >
                            {item.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        </div>

        <div class="footer-bottom">
          <div class="pk-container pk-section">
            <div class="footer-disclaimer">
              Decisions within the PKI Consortium are taken by substantial consensus of the members{" "}
              <a href="/bylaws/#10-voting">as specified in our bylaws</a>. Substantial consensus among members does not
              necessarily mean that all members share the same view or opinion.
            </div>
            <div>
              <small class="footer-copy">
                © {copyrightYear} PKI Consortium, Inc. · 501(c)(6) non-profit business league registered in Utah
                (#10462204-0140)
              </small>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
