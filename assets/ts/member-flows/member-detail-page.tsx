/**
 * Member profile detail page. Replaces
 * layouts/members/single.html (and independent.html), which rendered one
 * static page per YAML file via content/members/_content.gotmpl. Organization
 * ids are UUIDs now, not slugs, and D1 (not a build-time YAML scan) is the
 * source of truth — so instead of one generated Hugo page per member, this is
 * a single shell page (content/members/profile.md) that reads `?id=` from the
 * query string and fetches GET /api/v1/members/:id client-side, mirroring the
 * `?id=&token=` query-string pattern application-status-page.tsx already uses
 * for the same "no per-record static page" reason.
 *
 * The layout is the design system's: a measured column, a stack for vertical
 * rhythm, and a grid that reflows when its columns stop fitting — rather than
 * `col-lg-*`/`order-lg-*` pairs and an `mb-*` on every child. What is kept
 * from the legacy stylesheet is the branded initials avatar and the logo's
 * height, which are this site's own devices rather than Bootstrap's.
 */
import { Fragment, render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { Markdown } from "../components/Markdown";
import { NotFoundPanel } from "../components/NotFoundPanel";
import { Panel, PanelBody, PanelHeader } from "../ui/Panel";
import { memberInitials } from "../shared/member-display";
import { formatMonthYear } from "../shared/ui";
import { getLinkLabel } from "../../shared/schemas/links";
import {
  publicMemberDetailSchema,
  type PublicMemberDetail as MemberDetail,
} from "../../shared/schemas/members-directory";
// `pk-datalist` is a Content.css class, and component CSS ships in a lazy
// chunk rather than the entry stylesheet — a module that writes the class name
// has to import the sheet that defines it, or the list renders unstyled.
import "../ui/Content.css";

const API_BASE_FALLBACK = "/api/v1";

/** `/members/<slug>` (functions/members/[slug].ts) serves this exact shell
 * page with no `?id=` query string — the org's slug is the last path
 * segment instead. Returns null for the shell's own canonical path
 * (`/members/profile/`) so a direct, id-less visit still falls through to
 * "not found" rather than trying to fetch `/api/v1/members/profile`. */
function slugFromPathname(pathname: string): string | null {
  const match = /^\/members\/([^/]+)\/?$/.exec(pathname);
  if (!match) return null;
  return match[1] === "profile" ? null : match[1];
}

type PublicIdentity = MemberDetail["identities"][number];

/**
 * The owner's featured profile link — the first link of their canonical,
 * owner-ordered list, whatever the platform — labeled by its site.
 *
 * The accessible name carries the person's name beside the site label: this
 * page can show several of these links at once, and a bare site name twice
 * says nothing about whose profile either one opens.
 */
function FeaturedLink({ name, url }: { name: string; url?: string | null }) {
  if (!url) return null;
  const label = getLinkLabel(url);
  return (
    <a class="pk-small" href={url} target="_blank" rel="noopener" aria-label={`${name} on ${label}`}>
      {label}
    </a>
  );
}

/** Every link after the featured one already shown beside the heading. */
function OtherLinks({ links, featuredLink }: { links: string[]; featuredLink: string | null }) {
  const others = links.filter((url) => url !== featuredLink);
  return (
    <>
      {others.map((url) => (
        <Fragment key={url}>
          <dt>{getLinkLabel(url)}</dt>
          <dd class="pk-break">
            <a href={url} target="_blank" rel="noopener">
              {url}
            </a>
          </dd>
        </Fragment>
      ))}
    </>
  );
}

function IdentityCard({ identity }: { identity: PublicIdentity }) {
  return (
    <Panel>
      <PanelBody class="pk-stack pk-stack--snug">
        <div class="pk-cluster pk-cluster--start">
          {identity.photoUrl ? (
            // Decorative: the name it belongs to is the heading beside it, so
            // repeating it in `alt` announces the person twice.
            <img class="speaker-photo" alt="" src={identity.photoUrl} />
          ) : (
            <div
              aria-hidden="true"
              class={`standalone-initials standalone-initials--representative initial-color-${identity.name.length % 6}`}
            >
              {memberInitials(identity.name)}
            </div>
          )}
          <div class="pk-stack pk-stack--tight">
            <h3 class="pk-cluster">
              {identity.name}
              <FeaturedLink name={identity.name} url={identity.featuredLink} />
            </h3>
            {identity.jobTitle && <p class="pk-muted">{identity.jobTitle}</p>}
          </div>
        </div>
        {identity.bio && <Markdown markdown={identity.bio} />}
      </PanelBody>
    </Panel>
  );
}

export function MemberDetailView({ member, directoryHref }: { member: MemberDetail; directoryHref: string }) {
  const colorIdx = member.name.length % 6;
  const namedLinks: Array<[string, string | null | undefined]> = [
    ["Website", member.website],
    ["Press", member.pressUrl],
    ["Careers", member.careersUrl],
    ["Blog", member.blogUrl],
  ];

  return (
    <div class="pk pk-stack pk-stack--loose pk-section">
      <header class="pk-container pk-stack pk-stack--snug pk-center">
        {/* A cluster rather than `mx-auto`: the avatar is a fixed-size block,
            so centring it is the parent's job and text-align cannot do it. */}
        <div class="pk-cluster pk-cluster--center">
          {member.logoUrl ? (
            <img class="member-profile-logo" alt={member.name} src={member.logoUrl} />
          ) : (
            <div aria-hidden="true" class={`standalone-initials standalone-initials--hero initial-color-${colorIdx}`}>
              {memberInitials(member.name)}
            </div>
          )}
        </div>
        <h1>
          <strong>{member.name}</strong> is a member of the PKI Consortium
        </h1>
        {member.jobTitle && <p class="pk-lede">{member.jobTitle}</p>}
        {member.slogan && <p class="pk-lede">{member.slogan}</p>}
        {member.description && <p class="pk-lede">{member.description}</p>}
      </header>

      <div class="pk-container pk-grid pk-grid--roomy">
        {member.content && (
          <div class="pk-stack">
            <Markdown markdown={member.content} />
          </div>
        )}
        <Panel>
          <PanelHeader title="Member details" headingLevel={2}>
            <FeaturedLink name={member.name} url={member.featuredLink} />
          </PanelHeader>
          <PanelBody>
            {/* A term/value list, which is what this always was: it used to be
                a run of `<strong>Label:</strong> value<br>` inside a `<small>`,
                so nothing paired a term with its value for a reader who could
                not see the layout. */}
            <dl class="pk-datalist pk-small">
              <dt>Member since</dt>
              <dd>{formatMonthYear(member.memberSince)}</dd>
              {namedLinks.map(([label, url]) =>
                url ? (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd class="pk-break">
                      <a href={url} target="_blank" rel="noopener">
                        {url}
                      </a>
                    </dd>
                  </Fragment>
                ) : null,
              )}
              <OtherLinks links={member.links} featuredLink={member.featuredLink} />
            </dl>
          </PanelBody>
        </Panel>
      </div>

      {member.identities.length > 0 && (
        <section class="pk-container pk-stack" aria-labelledby="member-representatives">
          <h2 id="member-representatives">Representatives</h2>
          {member.identities.map((identity) => (
            <IdentityCard key={identity.name} identity={identity} />
          ))}
        </section>
      )}

      <p class="pk-container">
        <a href={directoryHref}>&larr; Back to members</a>
      </p>
    </div>
  );
}

export function MemberDetailPage({ apiBase, directoryHref }: { apiBase: string; directoryHref: string }) {
  const [member, setMember] = useState<MemberDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("id") ?? slugFromPathname(window.location.pathname);
    if (!id) {
      setNotFound(true);
      return;
    }
    getJson(`${apiBase}/members/${encodeURIComponent(id)}`, publicMemberDetailSchema)
      .then((data) => setMember(data))
      .catch((e) => {
        if ((e as { status?: number }).status === 404) setNotFound(true);
        else setError((e as Error).message);
      });
  }, [apiBase]);

  if (notFound) {
    return (
      <NotFoundPanel message="We couldn’t find that member." backHref={directoryHref} backLabel="Back to members" />
    );
  }
  if (error) return <ErrorAlert error={error} />;
  // Named, so the wait says what is loading rather than announcing a bare
  // "Loading…" on a page that is otherwise empty.
  if (!member) return <Spinner label="Loading member profile…" />;

  return <MemberDetailView member={member} directoryHref={directoryHref} />;
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-member-detail]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const directoryHref = root.dataset.directoryHref ?? "/members/";
  render(<MemberDetailPage apiBase={apiBase} directoryHref={directoryHref} />, root);
}

main();
