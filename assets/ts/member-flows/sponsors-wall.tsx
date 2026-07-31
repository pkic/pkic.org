/**
 * Public sponsor display (prd.md item 8 gap-closure plan). Replaces the
 * build-time `layouts/partials/sponsors/{collect,grid,strip}.html` +
 * `layouts/shortcodes/sponsors{,-level,-strip}.html` — which read
 * `hugo.Data.members`/`hugo.Data.sponsors` (`data/members/*.yaml`,
 * `data/sponsors.yaml`) at Hugo build time — with a Preact component that
 * fetches GET /api/v1/sponsors. D1 (organizations.sponsor_tier +
 * sponsorships) is now the source of truth, so an admin sponsorship pipeline
 * change shows up here on next page load, not just after a manual YAML edit
 * + Hugo rebuild.
 *
 * One mount handles four visual modes (data-mode), matching the old
 * shortcodes/partials exactly:
 *   - "grid"  — sponsors.html/grid.html: sponsors bucketed by tier weight
 *               (1-8), shuffled within a bucket, logo size scaled by weight.
 *   - "level" — sponsors-level.html: sponsors grouped into weight bands,
 *               each with a "Level" header row (used by /sponsors/ and event
 *               sponsor-tier pages).
 *   - "strip" — sponsors-strip.html/strip.html: a single row filtered to
 *               >= a minimum weight, sorted highest-to-lowest, arranged
 *               center-out via CSS `order` (used by the sitewide hero banner
 *               and the compact event-hero sponsor row).
 *   - "wall"  — members/wall.html: the combined homepage/footer member +
 *               sponsor logo wall (§1.6 Part B deferred this half — see that
 *               partial's own header comment). Fetches both GET /api/v1/members
 *               and GET /api/v1/sponsors and merges them client-side, same as
 *               the old build-time version did across hugo.Data.members +
 *               hugo.Data.sponsors. Unlike the old version, there's no
 *               "as of a past date" snapshot support (the `date` shortcode
 *               param) — D1 only has current state; the one blog post that
 *               used it (2021-07-12-casc-to-pkic.md) now just shows current
 *               members, a low-stakes simplification for a years-old post.
 *
 * `sponsorlevels.yaml`'s tier-ordinal table is kept as a static import here
 * (TIER_WEIGHTS below) rather than fetched — it's a stable ranking, not
 * sponsor data, the same reasoning that already kept it out of the member
 * directory migration (§1.6 Part B).
 */
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import type { DirectoryMember } from "./member-directory-page";

const API_BASE_FALLBACK = "/api/v1";

/** Mirrors data/sponsorlevels.yaml — one shared weight space across both the
 * consortium and event tier vocabularies (each name is unique across both). */
const TIER_WEIGHTS: Record<string, number> = {
  Bronze: 1,
  Silver: 2,
  Gold: 3,
  Platinum: 4,
  Titanium: 5,
  Diamond: 6,
  Ambassador: 1,
  Innovator: 2,
  Inspirator: 3,
  Leader: 4,
};
const MAX_TIER_WEIGHT = 6;

export interface PublicSponsor {
  id: string;
  name: string;
  website: string | null;
  logoUrl: string | null;
  tier: string | null;
  eventTier: string | null;
}

function weightOf(tier: string | null): number {
  return tier ? (TIER_WEIGHTS[tier] ?? 0) : 0;
}

/** The event-specific tier overrides the general one when both are present and
 * an event context is active — matches the old collect.html/grid.html's
 * `with (index .sponsor.sponsoring $sponsoring) { $level = .level }`. */
function effectiveTier(s: PublicSponsor, hasEventContext: boolean): string | null {
  return hasEventContext && s.eventTier ? s.eventTier : s.tier;
}

/** Highest of the two weights, regardless of context — used only for the
 * minWeight cutoff (strip mode), matching collect.html's `or (ge genWeight
 * minWeight) (ge evtWeight minWeight)`. */
function maxWeight(s: PublicSponsor): number {
  return Math.max(weightOf(s.tier), weightOf(s.eventTier));
}

function matchesLevel(s: PublicSponsor, level: string, hasEventContext: boolean): boolean {
  if (level === "all") {
    return s.tier !== null || (hasEventContext && s.eventTier !== null);
  }
  return s.tier === level || (hasEventContext && s.eventTier === level);
}

/** Deterministic-enough shuffle for display variety; re-run once per fetch, not per render. */
function shuffled<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function titleFor(s: PublicSponsor, level: string | null, eventName?: string): string {
  const context = eventName ?? "the PKI Consortium";
  return `${s.name} is a ${level ?? "sponsor"} sponsor for ${context}`;
}

function SponsorLogo({
  s,
  level,
  eventName,
  logoClass,
  style,
}: {
  s: PublicSponsor;
  level: string | null;
  eventName?: string;
  logoClass?: string;
  style?: string;
}) {
  if (!s.logoUrl) return null;
  const title = titleFor(s, level, eventName);
  return (
    <a href={s.website ?? "#"} title={title} target="_blank" rel="noopener noreferrer" class="sponsor-link">
      <img src={s.logoUrl} alt={title} title={title} class={logoClass ?? "sponsor-logo"} style={style} loading="lazy" />
    </a>
  );
}

function useSponsors(apiBase: string, eventName?: string): { sponsors: PublicSponsor[] | null; error: string | null } {
  const [sponsors, setSponsors] = useState<PublicSponsor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const qs = eventName ? `?eventName=${encodeURIComponent(eventName)}` : "";
        const data = await getJson<{ sponsors: PublicSponsor[] }>(`${apiBase}/sponsors${qs}`);
        if (!cancelled) setSponsors(data.sponsors);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          console.error("[sponsors-wall]", e);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, eventName]);

  return { sponsors, error };
}

// ── Grid mode (sponsors.html / grid.html) ──────────────────────────────────

function GridMode({
  apiBase,
  eventName,
  level,
  height,
  maxHeight,
  maxWidth,
  rows,
  logoClass,
}: {
  apiBase: string;
  eventName?: string;
  level: string;
  height?: number;
  maxHeight?: number;
  maxWidth?: number;
  rows: boolean;
  logoClass?: string;
}) {
  const { sponsors } = useSponsors(apiBase, eventName);
  const hasEventContext = Boolean(eventName);

  const buckets = useMemo(() => {
    if (!sponsors) return null;
    const matched = sponsors.filter((s) => matchesLevel(s, level, hasEventContext));
    const byWeight = new Map<number, PublicSponsor[]>();
    for (const s of shuffled(matched)) {
      const tier = effectiveTier(s, hasEventContext);
      const w = weightOf(tier);
      if (!byWeight.has(w)) byWeight.set(w, []);
      byWeight.get(w)!.push(s);
    }
    return byWeight;
  }, [sponsors, level, hasEventContext]);

  if (!buckets || buckets.size === 0) return null;

  const weights = Array.from({ length: MAX_TIER_WEIGHT }, (_, i) => MAX_TIER_WEIGHT - i).filter((w) => buckets.has(w));

  const items = weights.map((w) => (
    <>
      {buckets.get(w)!.map((s) => {
        const style = [
          maxHeight ? `max-height: ${Math.round(maxHeight * w)}px;` : "",
          maxWidth ? `max-width: ${Math.round(maxWidth * w)}px;` : "",
          height ? `height: ${Math.round(height * w)}px;` : "",
        ].join(" ");
        return (
          <SponsorLogo
            key={s.id}
            s={s}
            level={effectiveTier(s, hasEventContext)}
            eventName={eventName}
            logoClass={logoClass ? `sponsor-logo ${logoClass}` : "sponsor-logo"}
            style={style}
          />
        );
      })}
    </>
  ));

  return <div class="sponsors-list">{rows ? items.map((row, i) => <div key={i}>{row}</div>) : items}</div>;
}

// ── Level mode (sponsors-level.html) ───────────────────────────────────────

function LevelMode({ apiBase, eventName, level }: { apiBase: string; eventName?: string; level: string }) {
  const { sponsors } = useSponsors(apiBase, eventName);
  const hasEventContext = Boolean(eventName);

  const groups = useMemo(() => {
    if (!sponsors) return null;
    const matched = sponsors.filter((s) => matchesLevel(s, level, hasEventContext));
    const byWeight = new Map<number, { tierName: string; sponsors: PublicSponsor[] }>();
    for (const s of matched) {
      const tier = effectiveTier(s, hasEventContext);
      const w = weightOf(tier);
      if (!tier || w === 0) continue;
      if (!byWeight.has(w)) byWeight.set(w, { tierName: tier, sponsors: [] });
      byWeight.get(w)!.sponsors.push(s);
    }
    return Array.from(byWeight.entries()).sort((a, b) => b[0] - a[0]);
  }, [sponsors, level, hasEventContext]);

  if (!groups || groups.length === 0) return null;

  return (
    <div class="sponsors container text-center">
      {groups.map(([w, group]) => (
        <div key={w} class="row justify-content-center">
          <div data-weight={w} class="col border-top border-light-subtle m-2 position-relative">
            <span class="sponsor-level position-absolute top-0 start-50 translate-middle bg-white px-2">
              {group.tierName}
            </span>
            <div class="row">
              {group.sponsors.map((s) => (
                <div key={s.id} class="col p-4 align-self-center">
                  <SponsorLogo
                    s={s}
                    level={group.tierName}
                    eventName={eventName}
                    logoClass="sponsor-logo"
                    style={`--sponsor-weight: ${w};`}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Strip mode (sponsors-strip.html / strip.html / hero.html) ─────────────

function StripMode({
  apiBase,
  eventName,
  minWeight,
  containerClass,
  linkClass,
  logoClass,
  logoStyle,
  label,
  labelClass,
  maxItems,
}: {
  apiBase: string;
  eventName?: string;
  minWeight: number;
  containerClass: string;
  linkClass: string;
  logoClass: string;
  logoStyle?: string;
  label?: string;
  labelClass?: string;
  maxItems?: number;
}) {
  const { sponsors } = useSponsors(apiBase, eventName);
  const hasEventContext = Boolean(eventName);

  const sorted = useMemo(() => {
    if (!sponsors) return null;
    const matched = shuffled(sponsors.filter((s) => maxWeight(s) >= minWeight));
    const ranked = matched
      .map((s) => ({ s, weight: weightOf(effectiveTier(s, hasEventContext)) }))
      .sort((a, b) => b.weight - a.weight);
    return maxItems ? ranked.slice(0, maxItems) : ranked;
  }, [sponsors, minWeight, hasEventContext, maxItems]);

  if (!sorted || sorted.length === 0) return null;

  return (
    <>
      {label && (
        <div
          class={labelClass ?? "w-100 text-center mb-3 text-white text-uppercase"}
          style={labelClass ? undefined : "font-size: 0.7rem; letter-spacing: 0.1em; opacity: 0.6;"}
        >
          {label}
        </div>
      )}
      <div class={containerClass}>
        {sorted.map(({ s, weight }, i) => {
          const order = i % 2 === 0 ? -Math.floor(i / 2) : Math.floor((i + 1) / 2);
          const tier = effectiveTier(s, hasEventContext);
          const title = titleFor(s, tier, eventName);
          if (!s.logoUrl) return null;
          return (
            <a
              key={s.id}
              href={s.website ?? "#"}
              title={title}
              target="_blank"
              rel="noopener noreferrer"
              class={linkClass}
              style={`--sponsor-weight: ${weight}; order: ${order};`}
            >
              <img class={logoClass} alt={title} src={s.logoUrl} style={logoStyle} loading="lazy" />
            </a>
          );
        })}
      </div>
    </>
  );
}

// ── Wall mode (members/wall.html) ──────────────────────────────────────────

interface WallEntry {
  key: string;
  href: string;
  logoUrl: string;
  name: string;
  slogan: string | null;
  sponsorLevel: number;
  sponsorLevelName: string | null;
}

function useWallData(apiBase: string): { members: DirectoryMember[] | null; sponsors: PublicSponsor[] | null } {
  const [members, setMembers] = useState<DirectoryMember[] | null>(null);
  const [sponsors, setSponsors] = useState<PublicSponsor[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [m, s] = await Promise.all([
          getJson<{ members: DirectoryMember[] }>(`${apiBase}/members?group=organization&limit=500`),
          getJson<{ sponsors: PublicSponsor[] }>(`${apiBase}/sponsors`),
        ]);
        if (!cancelled) {
          setMembers(m.members);
          setSponsors(s.sponsors);
        }
      } catch (e) {
        console.error("[sponsors-wall]", e);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase]);

  return { members, sponsors };
}

function WallMode({ apiBase, memberLimit }: { apiBase: string; memberLimit: number }) {
  const { members, sponsors } = useWallData(apiBase);

  const entries = useMemo(() => {
    if (!members || !sponsors) return null;

    const sponsorByOrgId = new Map(sponsors.map((s) => [s.id, s]));
    const withLogo = members.filter((m) => m.logoUrl);

    const sponsorMembers: WallEntry[] = [];
    const nonSponsorMembers: WallEntry[] = [];
    for (const m of withLogo) {
      const sponsor = sponsorByOrgId.get(m.id);
      const href = m.slug
        ? `/members/${encodeURIComponent(m.slug)}/`
        : `/members/profile/?id=${encodeURIComponent(m.id)}`;
      const entry: WallEntry = {
        key: `member:${m.id}`,
        href,
        logoUrl: m.logoUrl!,
        name: m.name,
        slogan: m.slogan,
        sponsorLevel: sponsor ? weightOf(sponsor.tier) : 0,
        sponsorLevelName: sponsor?.tier ?? null,
      };
      (entry.sponsorLevel > 0 ? sponsorMembers : nonSponsorMembers).push(entry);
    }

    // Non-member sponsors (and any org-tied sponsor not otherwise rendered as
    // a member above, e.g. no active membership representative) are always
    // shown, same as the old wall.html's separate hugo.Data.sponsors loop.
    const memberOrgIds = new Set(withLogo.map((m) => m.id));
    const nonMemberSponsors: WallEntry[] = sponsors
      .filter((s) => !memberOrgIds.has(s.id) && s.logoUrl && s.tier)
      .map((s) => ({
        key: `sponsor:${s.id}`,
        href: s.website ?? "#",
        logoUrl: s.logoUrl!,
        name: s.name,
        slogan: null,
        sponsorLevel: weightOf(s.tier),
        sponsorLevelName: s.tier,
      }));

    const selectedNonSponsors = shuffled(nonSponsorMembers).slice(0, memberLimit);
    return shuffled([...sponsorMembers, ...nonMemberSponsors, ...selectedNonSponsors]);
  }, [members, sponsors, memberLimit]);

  // The marquee/scroll effects (sponsor-banner-marquee.js, members-overview-effects.js)
  // build their tracks by scanning the DOM once — they need to run after these anchors
  // actually exist, not at page load, since this data arrives async.
  useEffect(() => {
    if (entries) document.dispatchEvent(new CustomEvent("member:wall-rendered"));
  }, [entries]);

  if (!entries) return null;

  return (
    <>
      {entries.map((e) => (
        <a
          key={e.key}
          href={e.href}
          target="_blank"
          rel="noopener"
          data-sponsor-level={e.sponsorLevel}
          data-member-name={e.name}
          data-member-slogan={e.slogan ?? undefined}
          data-sponsor-level-name={e.sponsorLevel > 0 ? (e.sponsorLevelName ?? undefined) : undefined}
        >
          <img
            class={`member-logo${e.sponsorLevel > 0 ? ` member-logo-sponsor sponsor-lvl-${e.sponsorLevel}` : ""}`}
            alt={e.name}
            src={e.logoUrl}
            loading="lazy"
          />
        </a>
      ))}
    </>
  );
}

function main(): void {
  document.querySelectorAll<HTMLElement>("[data-sponsors-wall]").forEach((root) => {
    const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
    const eventName = root.dataset.eventName || undefined;
    const level = root.dataset.level ?? "all";
    const mode = root.dataset.mode ?? "grid";

    if (mode === "level") {
      render(<LevelMode apiBase={apiBase} eventName={eventName} level={level} />, root);
      return;
    }

    if (mode === "wall") {
      render(<WallMode apiBase={apiBase} memberLimit={Number(root.dataset.memberLimit ?? 999999)} />, root);
      return;
    }

    if (mode === "strip") {
      render(
        <StripMode
          apiBase={apiBase}
          eventName={eventName}
          minWeight={Number(root.dataset.minWeight ?? 5)}
          containerClass={
            root.dataset.containerClass ?? "d-flex justify-content-center align-items-center flex-wrap gap-4 my-4"
          }
          linkClass={root.dataset.linkClass ?? "sponsor-link"}
          logoClass={root.dataset.logoClass ?? "sponsor-logo"}
          logoStyle={root.dataset.logoStyle}
          label={root.dataset.label}
          labelClass={root.dataset.labelClass}
          maxItems={root.dataset.maxItems ? Number(root.dataset.maxItems) : undefined}
        />,
        root,
      );
      return;
    }

    render(
      <GridMode
        apiBase={apiBase}
        eventName={eventName}
        level={level}
        height={root.dataset.height ? Number(root.dataset.height) : undefined}
        maxHeight={root.dataset.maxHeight ? Number(root.dataset.maxHeight) : undefined}
        maxWidth={root.dataset.maxWidth ? Number(root.dataset.maxWidth) : undefined}
        rows={root.dataset.rows === "true"}
        logoClass={root.dataset.class}
      />,
      root,
    );
  });
}

main();
