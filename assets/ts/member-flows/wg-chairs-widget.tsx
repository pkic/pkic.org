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
import { workingGroupDetailSchema, type WorkingGroupDetail } from "../../shared/schemas/members-directory";
import { getJson } from "../shared/api-client";
import { PublicPersonCard } from "./components/public-person-card";

const API_BASE_FALLBACK = "/api/v1";

type Mode = "compact" | "card";

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
  const [data, setData] = useState<WorkingGroupDetail | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson<unknown>(`${apiBase}/working-groups/${encodeURIComponent(slug)}`)
      .then((response) => setData(workingGroupDetailSchema.parse(response)))
      .catch(() => setFailed(true));
  }, [apiBase, slug]);

  const hasData = !failed && !!data && (!!data.chair || !!data.viceChair);

  useEffect(() => {
    if (hasData) onReveal?.();
  }, [hasData]);

  if (!hasData) return null;

  const avatarSize = mode === "card" ? "small" : "default";
  const cards = (
    <>
      {data!.chair && (
        <PublicPersonCard person={data!.chair} role={`${wgLabel} Chair`} color={color} avatarSize={avatarSize} />
      )}
      {data!.viceChair && (
        <PublicPersonCard
          person={data!.viceChair}
          role={`${wgLabel} Vice Chair`}
          color={color}
          avatarSize={avatarSize}
        />
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
