/**
 * Working group chair/vice-chair display. Replaces the static
 * content/wg/&lt;slug&gt;/_index.md `chair:`/`viceChair:` frontmatter and
 * layouts/wg/section.html's `{{ with .Params.chair }}` block, both of which
 * required a git commit + rebuild to update — chairs are now assigned in
 * the admin portal (Access Control → Working Groups / Chairs, backed by
 * user_roles) and this widget fetches them client-side from the public
 * GET /api/v1/working-groups/:slug endpoint (members-directory.ts's
 * getWorkingGroupByIdOrSlug, extended to include chair/viceChair with
 * photo/LinkedIn/org-logo enrichment).
 *
 * Two render modes, chosen via the mount's `data-mode` attribute — both use
 * the same person-card.html-style ring card, differing only in avatar size
 * and page wrapper:
 *   - "compact" (default) — layouts/partials/wg/chairs-app.html's sidebar
 *     mount on the public WG page, wrapped in the "Working Group Leadership"
 *     label + .consortium-leaders grid, avatar size "md" (80px).
 *   - "card" — layouts/partials/wg/chairs-og-card.html's mount on the
 *     Puppeteer-rendered OG social-share card (all.og-card.html), bare
 *     (no wrapper), avatar size "sm" (72px). That page is
 *     screenshotted with `waitUntil: networkidle0`
 *     (functions/api/v1/og/card/[...path].ts), which waits for this fetch
 *     (and any resulting avatar/logo image loads) to settle before
 *     capturing, so the mount starts `hidden` and reveals itself — including
 *     switching its parent `.og-hero-inner` to the two-column layout — only
 *     once real chair data resolves. No data (WG has no chair yet) leaves it
 *     hidden, the same graceful fallback the page already had.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { getJson } from "../shared/api-client";

const API_BASE_FALLBACK = "/api/v1";

interface WgChairPublic {
  name: string;
  organizationName: string | null;
  organizationLogoUrl: string | null;
  organizationWebsite: string | null;
  photoUrl: string | null;
  linkedin: string | null;
}

interface WorkingGroupDetailResponse {
  chair: WgChairPublic | null;
  viceChair: WgChairPublic | null;
}

type Mode = "compact" | "card";

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function LinkedInBadge({ person }: { person: WgChairPublic }) {
  if (!person.linkedin) return null;
  return (
    <a
      href={person.linkedin}
      class="person-card-linkedin"
      target="_blank"
      rel="noopener noreferrer"
      title={`${person.name} on LinkedIn`}
      aria-label="LinkedIn"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" fill="currentColor" viewBox="0 0 16 16">
        <path d="M0 1.146C0 .513.526 0 1.175 0h13.65C15.474 0 16 .513 16 1.146v13.708c0 .633-.526 1.146-1.175 1.146H1.175C.526 16 0 15.487 0 14.854zm4.943 12.248V6.169H2.542v7.225zm-1.2-8.212c.837 0 1.358-.554 1.358-1.248-.015-.709-.52-1.248-1.342-1.248S2.4 3.226 2.4 3.934c0 .694.521 1.248 1.327 1.248zm4.908 8.212V9.359c0-.216.016-.432.08-.586.173-.431.568-.878 1.232-.878.869 0 1.216.662 1.216 1.634v3.865h2.401V9.25c0-2.22-1.184-3.252-2.764-3.252-1.274 0-1.845.7-2.165 1.193v.025h-.016l.016-.025V6.169h-2.4c.03.678 0 7.225 0 7.225z" />
      </svg>
    </a>
  );
}

function OrgLink({
  person,
  className,
  children,
}: {
  person: WgChairPublic;
  className: string;
  children: ComponentChildren;
}) {
  return person.organizationWebsite ? (
    <a
      href={person.organizationWebsite}
      target="_blank"
      rel="noopener noreferrer"
      title={person.organizationName ?? undefined}
      class={className}
    >
      {children}
    </a>
  ) : (
    <span class={className}>{children}</span>
  );
}

function OrgBlock({
  person,
  orgClass,
  logoWrapClass,
  logoClass,
  nameClass,
}: {
  person: WgChairPublic;
  orgClass: string;
  logoWrapClass: string;
  logoClass: string;
  nameClass: string;
}) {
  if (!person.organizationName) return null;
  return (
    <div class={orgClass}>
      {person.organizationLogoUrl ? (
        <OrgLink person={person} className={logoWrapClass}>
          <img src={person.organizationLogoUrl} alt={person.organizationName} class={logoClass} loading="lazy" />
        </OrgLink>
      ) : (
        <OrgLink person={person} className={nameClass}>
          {person.organizationName}
        </OrgLink>
      )}
    </div>
  );
}

function ChairCard({
  person,
  role,
  color,
  avatarPx,
}: {
  person: WgChairPublic;
  role: string;
  color: string;
  avatarPx: number;
}) {
  return (
    <div class="person-card">
      <div class="person-card-main">
        <div class="person-card-avatar-frame" style={{ "--avatar-px": `${avatarPx}px` }}>
          {person.photoUrl ? (
            <img class="person-card-avatar" src={person.photoUrl} alt={person.name} loading="lazy" />
          ) : (
            <div class={`person-card-avatar person-card-avatar--initials wg-${color}`}>{initialsFor(person.name)}</div>
          )}
          <span class="person-card-role-arc">{role}</span>
        </div>
        <div class="person-card-body">
          <div class="person-card-name-row">
            <span class="person-card-name">{person.name}</span>
            <LinkedInBadge person={person} />
          </div>
          <OrgBlock
            person={person}
            orgClass="person-card-org"
            logoWrapClass="person-card-org-logo-wrap"
            logoClass="person-card-org-logo"
            nameClass="person-card-org-name"
          />
        </div>
      </div>
    </div>
  );
}

function WgChairsWidget({
  apiBase,
  slug,
  wgLabel,
  color,
  mode,
  onReveal,
}: {
  apiBase: string;
  slug: string;
  wgLabel: string;
  color: string;
  mode: Mode;
  onReveal?: () => void;
}) {
  const [data, setData] = useState<WorkingGroupDetailResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson<WorkingGroupDetailResponse>(`${apiBase}/working-groups/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [apiBase, slug]);

  const hasData = !failed && !!data && (!!data.chair || !!data.viceChair);

  useEffect(() => {
    if (hasData) onReveal?.();
  }, [hasData]);

  if (!hasData) return null;

  const avatarPx = mode === "card" ? 72 : 80;
  const cards = (
    <>
      {data!.chair && <ChairCard person={data!.chair} role={`${wgLabel} Chair`} color={color} avatarPx={avatarPx} />}
      {data!.viceChair && (
        <ChairCard person={data!.viceChair} role={`${wgLabel} Vice Chair`} color={color} avatarPx={avatarPx} />
      )}
    </>
  );

  if (mode === "card") return cards;

  return (
    <>
      <div class="wg-leadership-label">Working Group Leadership</div>
      <div class="consortium-leaders">{cards}</div>
    </>
  );
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-wg-chairs]").forEach((root) => {
    const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
    const slug = root.dataset.wgSlug ?? "";
    const wgLabel = root.dataset.wgLabel ?? "";
    const color = root.dataset.color ?? "green";
    const mode: Mode = root.dataset.mode === "card" ? "card" : "compact";
    if (!slug) return;

    const onReveal =
      mode === "card"
        ? () => {
            root.hidden = false;
            root.closest<HTMLElement>(".og-hero-inner")?.classList.add("og-hero-inner--with-visual");
          }
        : undefined;

    render(
      <WgChairsWidget apiBase={apiBase} slug={slug} wgLabel={wgLabel} color={color} mode={mode} onReveal={onReveal} />,
      root,
    );
  });
}

main();
