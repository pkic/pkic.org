/**
 * Working group chair/vice-chair display. Replaces the static
 * content/wg/&lt;slug&gt;/_index.md `chair:`/`viceChair:` frontmatter and
 * layouts/wg/section.html's `{{ with .Params.chair }}` block, both of which
 * required a git commit + rebuild to update — chairs are now assigned in
 * the admin portal (Access Control → Working Groups / Chairs, backed by
 * user_roles) and this widget fetches them client-side from the public
 * GET /api/v1/working-groups/:slug endpoint (members-directory.ts's
 * getWorkingGroupByIdOrSlug, extended to include chair/viceChair).
 *
 * Renders with the same CSS classes as layouts/partials/person-card.html's
 * "compact" mode (initials avatar only) — no photo/org-logo/LinkedIn
 * enrichment, since the public working-group endpoint deliberately exposes
 * only a name + organization-name "public subset" (matching its existing
 * member-roster convention), not full member-directory profiles. A chair
 * who is also a public directory member still gets their full profile via
 * that separate page; this widget only needs to solve "who is the chair,"
 * mirroring the same intentional scope trim documented in prd.md §1.6 Part
 * B decision 8 for working-group tags.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";

const API_BASE_FALLBACK = "/api/v1";

interface WgChairPublic {
  name: string;
  organizationName: string | null;
}

interface WorkingGroupDetailResponse {
  chair: WgChairPublic | null;
  viceChair: WgChairPublic | null;
}

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");
}

function ChairCard({ person, role, color }: { person: WgChairPublic; role: string; color: string }) {
  return (
    <div class="person-card-compact">
      <div class="person-card-compact-avatar-wrap">
        <div class={`person-card-compact-avatar person-card-compact-avatar--initials wg-${color}`}>
          {initialsFor(person.name)}
        </div>
      </div>
      <div class="person-card-compact-body">
        <div class="person-card-compact-name-row">
          <span class="person-card-compact-name">{person.name}</span>
        </div>
        <div class="person-card-compact-role">{role}</div>
        {person.organizationName && (
          <div class="person-card-compact-org">
            <span class="person-card-org-name">{person.organizationName}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function WgChairsWidget({
  apiBase,
  slug,
  wgLabel,
  color,
}: {
  apiBase: string;
  slug: string;
  wgLabel: string;
  color: string;
}) {
  const [data, setData] = useState<WorkingGroupDetailResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getJson<WorkingGroupDetailResponse>(`${apiBase}/working-groups/${encodeURIComponent(slug)}`)
      .then(setData)
      .catch(() => setFailed(true));
  }, [apiBase, slug]);

  if (failed || !data || (!data.chair && !data.viceChair)) return null;

  return (
    <>
      <div class="wg-leadership-label">Working Group Leadership</div>
      <div class="consortium-leaders">
        {data.chair && <ChairCard person={data.chair} role={`${wgLabel} Chair`} color={color} />}
        {data.viceChair && <ChairCard person={data.viceChair} role={`${wgLabel} Vice Chair`} color={color} />}
      </div>
    </>
  );
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-wg-chairs]");
  if (!root) return;

  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const slug = root.dataset.wgSlug ?? "";
  const wgLabel = root.dataset.wgLabel ?? "";
  const color = root.dataset.color ?? "green";
  if (!slug) return;

  render(<WgChairsWidget apiBase={apiBase} slug={slug} wgLabel={wgLabel} color={color} />, root);
}

main();
