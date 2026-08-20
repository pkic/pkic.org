/**
 * Public sponsor display. Replaces the
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
 *               sponsor logo wall returned by GET /api/v1/members/wall.
 *               Unlike the old version, there's no
 *               "as of a past date" snapshot support (the `date` shortcode
 *               param) — D1 only has current state; the one blog post that
 *               used it (2021-07-12-casc-to-pkic.md) now just shows current
 *               members, a low-stakes simplification for a years-old post.
 *
 * Filtering, tier weighting, sorting, counting, and pagination are owned by
 * the D1 read model. This component only arranges the returned page for each
 * visual mode.
 */
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { memberWallResponseSchema, type MemberWallEntry } from "../../shared/schemas/members-directory";
import { sponsorsListResponseSchema, type PublicSponsor } from "../../shared/schemas/public-sponsors";

const API_BASE_FALLBACK = "/api/v1";

const MAX_TIER_WEIGHT = 6;

function titleFor(s: PublicSponsor, level: string | null, eventName?: string): string {
  const context = eventName ?? "the PKI Consortium";
  return `${s.name} is a ${level ?? "sponsor"} sponsor for ${context}`;
}

function SponsorLogo({
  s,
  level,
  eventName,
  logoClass,
  sizeClass,
}: {
  s: PublicSponsor;
  level: string | null;
  eventName?: string;
  logoClass?: string;
  sizeClass?: string;
}) {
  if (!s.logoUrl) return null;
  const title = titleFor(s, level, eventName);
  return (
    <a href={s.website ?? "#"} title={title} target="_blank" rel="noopener noreferrer" class="sponsor-link">
      <img
        src={s.logoUrl}
        alt={title}
        title={title}
        class={[logoClass ?? "sponsor-logo", sizeClass].filter(Boolean).join(" ")}
        loading="lazy"
      />
    </a>
  );
}

function useSponsors(
  apiBase: string,
  options: { eventName?: string; level?: string; minWeight?: number; limit?: number; sort?: "name" | "-weight" },
): { sponsors: PublicSponsor[] | null; error: string | null } {
  const [sponsors, setSponsors] = useState<PublicSponsor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const query = new URLSearchParams({
          limit: String(options.limit ?? 200),
          sort: options.sort ?? "-weight",
        });
        if (options.eventName) query.set("eventName", options.eventName);
        if (options.level) query.set("level", options.level);
        if (options.minWeight !== undefined) query.set("minWeight", String(options.minWeight));
        const data = sponsorsListResponseSchema.parse(await getJson<unknown>(`${apiBase}/sponsors?${query}`));
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
  }, [apiBase, options.eventName, options.level, options.minWeight, options.limit, options.sort]);

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
  const { sponsors } = useSponsors(apiBase, { eventName, level, sort: "-weight" });

  const buckets = useMemo(() => {
    if (!sponsors) return null;
    const byWeight = new Map<number, PublicSponsor[]>();
    for (const s of sponsors) {
      const w = s.weight;
      if (!byWeight.has(w)) byWeight.set(w, []);
      byWeight.get(w)!.push(s);
    }
    return byWeight;
  }, [sponsors]);

  if (!buckets || buckets.size === 0) return null;

  const weights = Array.from({ length: MAX_TIER_WEIGHT }, (_, i) => MAX_TIER_WEIGHT - i).filter((w) => buckets.has(w));

  const items = weights.map((w) => (
    <>
      {buckets.get(w)!.map((s) => {
        const sizeClasses = [
          `sponsor-weight-${w}`,
          height === 20 ? "sponsor-grid-height-20" : "",
          maxHeight === 20 ? "sponsor-grid-max-height-20" : "",
          maxWidth === 60 ? "sponsor-grid-max-width-60" : "",
        ];
        return (
          <SponsorLogo
            key={s.id}
            s={s}
            level={s.effectiveTier}
            eventName={eventName}
            logoClass={logoClass ? `sponsor-logo ${logoClass}` : "sponsor-logo"}
            sizeClass={sizeClasses.filter(Boolean).join(" ")}
          />
        );
      })}
    </>
  ));

  return <div class="sponsors-list">{rows ? items.map((row, i) => <div key={i}>{row}</div>) : items}</div>;
}

// ── Level mode (sponsors-level.html) ───────────────────────────────────────

function LevelMode({ apiBase, eventName, level }: { apiBase: string; eventName?: string; level: string }) {
  const { sponsors } = useSponsors(apiBase, { eventName, level, sort: "-weight" });

  const groups = useMemo(() => {
    if (!sponsors) return null;
    const byWeight = new Map<number, { tierName: string; sponsors: PublicSponsor[] }>();
    for (const s of sponsors) {
      const tier = s.effectiveTier;
      const w = s.weight;
      if (!byWeight.has(w)) byWeight.set(w, { tierName: tier, sponsors: [] });
      byWeight.get(w)!.sponsors.push(s);
    }
    return Array.from(byWeight.entries()).sort((a, b) => b[0] - a[0]);
  }, [sponsors]);

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
                    sizeClass={`sponsor-weight-${w}`}
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
  label?: string;
  labelClass?: string;
  maxItems?: number;
}) {
  const { sponsors } = useSponsors(apiBase, {
    eventName,
    minWeight,
    limit: maxItems,
    sort: "-weight",
  });
  const sorted = sponsors?.map((s) => ({ s, weight: s.weight })) ?? null;

  if (!sorted || sorted.length === 0) return null;
  const centered = sorted
    .map((entry, index) => ({
      ...entry,
      order: index % 2 === 0 ? -Math.floor(index / 2) : Math.floor((index + 1) / 2),
    }))
    .sort((left, right) => left.order - right.order);

  return (
    <>
      {label && (
        <div class={labelClass ?? "w-100 text-center mb-3 text-white text-uppercase sponsor-strip-default-label"}>
          {label}
        </div>
      )}
      <div class={containerClass}>
        {centered.map(({ s, weight }) => {
          const tier = s.effectiveTier;
          const title = titleFor(s, tier, eventName);
          if (!s.logoUrl) return null;
          return (
            <a
              key={s.id}
              href={s.website ?? "#"}
              title={title}
              target="_blank"
              rel="noopener noreferrer"
              class={`${linkClass} sponsor-weight-${weight}`}
            >
              <img class={`${logoClass} sponsor-strip-default-logo`} alt={title} src={s.logoUrl} loading="lazy" />
            </a>
          );
        })}
      </div>
    </>
  );
}

// ── Wall mode (members/wall.html) ──────────────────────────────────────────

function useWallEntries(apiBase: string, memberLimit: number): MemberWallEntry[] | null {
  const [entries, setEntries] = useState<MemberWallEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await getJson<unknown>(`${apiBase}/members/wall?memberLimit=${memberLimit}`);
        if (!cancelled) {
          setEntries(memberWallResponseSchema.parse(response).entries);
        }
      } catch (e) {
        console.error("[sponsors-wall]", e);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, memberLimit]);

  return entries;
}

function WallMode({ apiBase, memberLimit }: { apiBase: string; memberLimit: number }) {
  const entries = useWallEntries(apiBase, memberLimit);

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
      render(<WallMode apiBase={apiBase} memberLimit={Math.min(200, Number(root.dataset.memberLimit ?? 200))} />, root);
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
