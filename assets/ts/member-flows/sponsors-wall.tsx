/**
 * Public sponsor display. Replaces the
 * build-time sponsor partials and shortcodes — which read the member and
 * sponsor YAML (`data/members/*.yaml`, `data/sponsors.yaml`) at build time —
 * with a Preact component that
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
import { initMemberLogoTreatment } from "../shared/member-logo-treatment";
import { render } from "preact";
import { SponsorGridView, SponsorLevelView, SponsorStripView, MemberWallView } from "../site/SponsorDisplays";
import { useEffect, useState } from "preact/hooks";
import { getJson } from "../shared/api-client";
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";
import { memberWallResponseSchema, type MemberWallEntry } from "../../shared/schemas/members-directory";
import { SPONSOR_DISPLAY_LIMIT, useSponsorDisplay, useSponsorList } from "./sponsors-wall-data";

import "../site/sponsors-wall.css";

const API_BASE_FALLBACK = "/api/v1";

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

  return (
    <>
      <SponsorGridView
        display={display}
        eventName={eventName}
        height={height}
        maxHeight={maxHeight}
        maxWidth={maxWidth}
        rows={rows}
        logoClass={logoClass}
      />
      <SponsorLoadMore hasMore={display.page.hasMore} loading={loadingMore} onClick={() => void loadMore()} />
    </>
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

  return (
    <>
      <SponsorLevelView display={display} eventName={eventName} />
      <SponsorLoadMore hasMore={display.page.hasMore} loading={loadingMore} onClick={() => void loadMore()} />
    </>
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
  if (error) return <SponsorLoadError message={error} />;
  return (
    <SponsorStripView
      sponsors={sponsors ?? []}
      eventName={eventName}
      containerClass={containerClass}
      linkClass={linkClass}
      logoClass={logoClass}
      label={label}
      labelClass={labelClass}
    />
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

  // The marquee and the hover/zoom effects scan the DOM once. They have to run
  // after these anchors exist, not at page load, because the data is fetched.
  useEffect(() => {
    if (entries) document.dispatchEvent(new CustomEvent("member:wall-rendered"));
  }, [entries]);

  if (state === "error") {
    return <p class="pk-muted pk-small">Member logos could not be loaded.</p>;
  }

  if (!entries?.length) return null;

  /*
   * The published wall's own markup: one anchor per member carrying the
   * sponsor level, the name and the slogan. `members-overview-effects.js`
   * reads those attributes to build the scrolling track, the hover card and
   * the sponsor zoom overlay, and the stylesheet colours a sponsor's logo by
   * its `sponsor-lvl-N` class while every other logo stays greyscale.
   */
  return <MemberWallView entries={entries} />;
}

function main(): void {
  initMemberLogoTreatment();
  document.querySelectorAll<HTMLElement>("[data-sponsors-wall]").forEach((root) => {
    // The server placeholder is not part of the interactive component tree.
    // Clear it before Preact mounts so an empty response is genuinely empty.
    root.replaceChildren();
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
          memberLimit={Math.min(200, Number(root.dataset.memberLimit ?? root.dataset.limit ?? 200))}
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
