/**
 * Working group chair/vice-chair display. Replaces the static
 * content/wg/&lt;slug&gt;/_index.md `chair:`/`viceChair:` frontmatter and
 * layouts/wg/section.html's `{{ with .Params.chair }}` block, both of which
 * required a git commit + rebuild to update — chairs are now assigned in
 * the group's Leadership tab in the portal (capacity-bound user_roles with
 * the title the group type configures) and this widget fetches them
 * client-side from the public generic GET /api/v1/groups/:slug/directory
 * endpoint, with public photo/profile-link/organization enrichment.
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
 *     (functions/og/[...path].ts), which waits for this fetch
 *     (and any resulting avatar/logo image loads) to settle before
 *     capturing, so the mount starts `hidden` and reveals itself — including
 *     switching its parent `.og-hero-inner` to the two-column layout — only
 *     once real chair data resolves. No data (WG has no chair yet) leaves it
 *     hidden, the same graceful fallback the page already had.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { groupDirectoryResponseSchema, type GroupDirectoryResponse } from "../../shared/schemas/group-directory";
import { getJson } from "../shared/api-client";
import { PublicPersonCard } from "./components/public-person-card";

const API_BASE_FALLBACK = "/api/v1";

type Mode = "compact" | "card";

export function WgChairsWidget({
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
  const [data, setData] = useState<GroupDirectoryResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson(`${apiBase}/groups/${encodeURIComponent(slug)}/directory`, groupDirectoryResponseSchema)
      .then((response) => setData(response))
      .catch(() => setFailed(true));
  }, [apiBase, slug]);

  const leaders = data?.leadership ?? [];
  const hasData = !failed && leaders.length > 0;

  useEffect(() => {
    if (hasData) onReveal?.();
  }, [hasData]);

  if (!hasData) return null;

  const avatarSize = mode === "card" ? "small" : "default";
  const cards = (
    <>
      {leaders.map((assignment) => (
        <PublicPersonCard
          key={`${assignment.sourceGroup?.id ?? "private-source"}:${assignment.roleId}:${assignment.person.name}`}
          person={assignment.person}
          role={`${wgLabel} ${assignment.title}`}
          color={color}
          avatarSize={avatarSize}
        />
      ))}
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
