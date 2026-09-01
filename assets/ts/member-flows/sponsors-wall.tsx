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
import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { memberWallResponseSchema, type MemberWallEntry } from "../../shared/schemas/members-directory";
import type { PublicSponsor } from "../../shared/schemas/public-sponsors";
import { SPONSOR_DISPLAY_LIMIT, useSponsorDisplay, useSponsorList } from "./sponsors-wall-data";

const API_BASE_FALLBACK = "/api/v1";

export function sponsorWeightsDescending(sponsors: PublicSponsor[]): number[] {
  return [...new Set(sponsors.map(({ weight }) => weight))].sort((a, b) => b - a);
}

/** Keep arbitrary data-backed weights ordered while bounding their visual scale. */
export function sponsorWeightClass(weight: number): string {
  return `sponsor-weight-${Math.min(8, Math.max(1, Math.trunc(weight)))}`;
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

function SponsorLoadError({ message }: { message: string }) {
  return <Alert tone="danger">Sponsors could not be loaded: {message}</Alert>;
}

function SponsorLoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null;
  // `loading` rather than `disabled`: a disabled control loses focus, which
  // throws a keyboard user out of the list they were paging through.
  return (
    <Button variant="secondary" loading={loading} onClick={onClick}>
      {loading ? "Loading sponsors…" : "Load more sponsors"}
    </Button>
  );
}

// ── Grid mode (sponsors.html / grid.html) ──────────────────────────────────

function GridMode({
  apiBase,
  eventSlug,
  eventName,
  level,
  height,
  maxHeight,
  maxWidth,
  rows,
  logoClass,
}: {
  apiBase: string;
  eventSlug?: string;
  eventName?: string;
  level: string;
  height?: number;
  maxHeight?: number;
  maxWidth?: number;
  rows: boolean;
  logoClass?: string;
}) {
  const { display, error, loadingMore, loadMore } = useSponsorDisplay(apiBase, {
    eventSlug,
    eventName,
    level,
    sort: "-weight",
  });

  if (error) return <SponsorLoadError message={error} />;
  if (!display || display.groups.length === 0) return null;

  const items = display.groups.map(({ weight: w, sponsors }) => (
    <>
      {sponsors.map((s) => {
        const sizeClasses = [
          sponsorWeightClass(w),
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

  return (
    <div class="pk-stack">
      <div class="sponsors-list">{rows ? items.map((row, i) => <div key={i}>{row}</div>) : items}</div>
      <SponsorLoadMore hasMore={display.page.hasMore} loading={loadingMore} onClick={() => void loadMore()} />
    </div>
  );
}

// ── Level mode (sponsors-level.html) ───────────────────────────────────────

function LevelMode({
  apiBase,
  eventSlug,
  eventName,
  level,
}: {
  apiBase: string;
  eventSlug?: string;
  eventName?: string;
  level: string;
}) {
  const { display, error, loadingMore, loadMore } = useSponsorDisplay(apiBase, {
    eventSlug,
    eventName,
    level,
    sort: "-weight",
  });

  if (error) return <SponsorLoadError message={error} />;
  if (!display || display.groups.length === 0) return null;

  /*
   * The tier band — a rule with its name sitting on it — was built out of
   * Bootstrap's grid and position utilities in the markup. It is now two class
   * names whose rules live in `assets/scss/sponsors.scss`, beside the rest of
   * this surface's appearance: the surface is still styled from the legacy
   * sheet, so moving the layout there keeps one owner rather than splitting it
   * between a stylesheet and a row of utility classes. The wrapper the logos
   * each sat in is gone with the grid — the row is a flex container now, so a
   * logo needs nothing around it to be centered.
   */
  return (
    <div class="sponsors pk-stack pk-center">
      {display.groups.map((group) => (
        <div key={group.weight} data-weight={group.weight} class="sponsors-tier">
          <span class="sponsor-level">{group.tierName}</span>
          <div class="sponsors-tier-logos">
            {group.sponsors.map((s) => (
              <SponsorLogo
                key={s.id}
                s={s}
                level={group.tierName}
                eventName={eventName}
                logoClass="sponsor-logo"
                sizeClass={sponsorWeightClass(group.weight)}
              />
            ))}
          </div>
        </div>
      ))}
      <SponsorLoadMore hasMore={display.page.hasMore} loading={loadingMore} onClick={() => void loadMore()} />
    </div>
  );
}

// ── Strip mode (sponsors-strip.html / strip.html / hero.html) ─────────────

function StripMode({
  apiBase,
  eventSlug,
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
  eventSlug?: string;
  eventName?: string;
  minWeight: number;
  containerClass: string;
  linkClass: string;
  logoClass: string;
  label?: string;
  labelClass?: string;
  maxItems?: number;
}) {
  const { sponsors, error } = useSponsorList(apiBase, {
    eventSlug,
    eventName,
    minWeight,
    limit: maxItems ?? SPONSOR_DISPLAY_LIMIT,
    sort: "-weight",
  });
  const sorted = sponsors?.map((s) => ({ s, weight: s.weight })) ?? null;

  if (error) return <SponsorLoadError message={error} />;
  if (!sorted || sorted.length === 0) return null;
  const centered = sorted
    .map((entry, index) => ({
      ...entry,
      order: index % 2 === 0 ? -Math.floor(index / 2) : Math.floor((index + 1) / 2),
    }))
    .sort((left, right) => left.order - right.order);

  return (
    <>
      {label && <div class={labelClass ?? "sponsor-strip-default-label"}>{label}</div>}
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
              class={`${linkClass} ${sponsorWeightClass(weight)}`}
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

/**
 * What the wall knows about its logos, which is not the same as how many it
 * has.
 *
 * The band reserves a fixed height for the scrolling track, so the difference
 * between "still fetching" and "there is nothing" has to reach the stylesheet:
 * collapsing while the logos are on their way would drop the rest of the page
 * out from under the reader, and holding the space open forever leaves a
 * silent white hole where the members should be.
 */
export type WallState = "loading" | "ready" | "empty" | "error";

function useWallEntries(apiBase: string, memberLimit: number): { entries: MemberWallEntry[] | null; state: WallState } {
  const [entries, setEntries] = useState<MemberWallEntry[] | null>(null);
  const [state, setState] = useState<WallState>("loading");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await getJson(`${apiBase}/members/wall?memberLimit=${memberLimit}`, memberWallResponseSchema);
        if (cancelled) return;
        setEntries(response.entries);
        setState(response.entries.length > 0 ? "ready" : "empty");
      } catch (e) {
        console.error("[sponsors-wall]", e);
        // A failure is reported, not swallowed into the same blank the
        // loading state renders.
        if (!cancelled) setState("error");
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [apiBase, memberLimit]);

  return { entries, state };
}

function WallMode({
  apiBase,
  memberLimit,
  onState,
}: {
  apiBase: string;
  memberLimit: number;
  /** Reports the state to the mount element, where the stylesheet reads it. */
  onState?: (state: WallState) => void;
}) {
  const { entries, state } = useWallEntries(apiBase, memberLimit);

  useEffect(() => {
    onState?.(state);
  }, [onState, state]);

  // The marquee/scroll effects (sponsor-banner-marquee.js, members-overview-effects.js)
  // build their tracks by scanning the DOM once — they need to run after these anchors
  // actually exist, not at page load, since this data arrives async.
  useEffect(() => {
    if (entries) document.dispatchEvent(new CustomEvent("member:wall-rendered"));
  }, [entries]);

  if (state === "error") {
    return <p class="pk-muted pk-small">Member logos could not be loaded.</p>;
  }

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
    const eventSlug = root.dataset.eventSlug || undefined;
    const eventName = root.dataset.eventName || undefined;
    const level = root.dataset.level ?? "all";
    const mode = root.dataset.mode ?? "grid";

    if (mode === "level") {
      render(<LevelMode apiBase={apiBase} eventSlug={eventSlug} eventName={eventName} level={level} />, root);
      return;
    }

    if (mode === "wall") {
      render(
        <WallMode
          apiBase={apiBase}
          memberLimit={Math.min(200, Number(root.dataset.memberLimit ?? 200))}
          onState={(state) => {
            root.dataset.state = state;
          }}
        />,
        root,
      );
      return;
    }

    if (mode === "strip") {
      render(
        <StripMode
          apiBase={apiBase}
          eventSlug={eventSlug}
          eventName={eventName}
          minWeight={Number(root.dataset.minWeight ?? 5)}
          // A centered, wrapping group: the cluster utility, rather than the
          // five Bootstrap utilities that used to say the same thing here.
          containerClass={root.dataset.containerClass ?? "pk-cluster pk-cluster--center"}
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
        eventSlug={eventSlug}
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
