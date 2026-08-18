/**
 * Public votes index (Public-facing pages). A Hugo
 * static shell that fetches GET /api/v1/votes (already filtered server-side
 * to visibility='public') and lists them grouped by status, mirroring the
 * member-directory-page.tsx pattern: one client-side fetch per page load,
 * no per-vote static page since D1 (not a build-time scan) is the source
 * of truth.
 *
 * Each of the two sections ("Open for voting" and "Closed") is its own
 * bounded, server-paginated query — not a single capped fetch grouped
 * client-side — so a "Load more" click, not silent truncation, is what
 * happens once a section's real total exceeds one page.
 *
 * Links to the detail page use a query-string slug
 * (`/votes/detail/?slug=`), not a real `/votes/:slug` path — Hugo can't
 * generate one static page per D1 vote at build time, the same reasoning
 * member-detail-page.tsx documents for `/members/profile/?id=`.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { z } from "zod";
import { getJson } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { publicVoteSchema } from "../../shared/schemas/votes";
import type { pageInfoSchema } from "../../shared/schemas/pagination";

const API_BASE_FALLBACK = "/api/v1";
const PAGE_SIZE = 20;

type PublicVote = z.infer<typeof publicVoteSchema>;
type VoteType = PublicVote["voteType"];
type VoteScopeType = PublicVote["scopeType"];
type PageInfo = z.infer<typeof pageInfoSchema>;

interface PublicVotesResponse {
  votes: PublicVote[];
  page: PageInfo;
}

interface VoteSection {
  votes: PublicVote[];
  page: PageInfo;
}

type SectionKey = "open" | "closed";

const SECTION_STATUS_FILTER: Record<SectionKey, string> = {
  open: "open,scheduled",
  closed: "closed",
};

const VOTE_TYPE_LABELS: Record<VoteType, string> = {
  election: "Election",
  motion: "Motion",
  consultation: "Consultation",
};

function statusBadgeClass(status: string): string {
  switch (status) {
    case "open":
      return "text-bg-success";
    case "scheduled":
      return "text-bg-info";
    default:
      return "text-bg-secondary";
  }
}

function scopeLabel(scopeType: VoteScopeType): string {
  return scopeType === "forum" ? "Forum" : "Working Group";
}

export function buildVotesSectionUrl(apiBase: string, section: SectionKey, offset: number): string {
  const status = SECTION_STATUS_FILTER[section];
  return `${apiBase}/votes?status=${status}&limit=${PAGE_SIZE}&offset=${offset}&sort=closes_at`;
}

export function mergeVotesSection(current: VoteSection, next: PublicVotesResponse): VoteSection {
  return { votes: [...current.votes, ...next.votes], page: next.page };
}

function fetchVotesSection(apiBase: string, section: SectionKey, offset: number): Promise<PublicVotesResponse> {
  return getJson<PublicVotesResponse>(buildVotesSectionUrl(apiBase, section, offset));
}

function VoteCard({ vote, detailBase }: { vote: PublicVote; detailBase: string }) {
  const href = `${detailBase}?slug=${encodeURIComponent(vote.slug)}`;
  return (
    <div class="member-card bento-card">
      <a class="stretched-link" href={href} aria-label={vote.title}></a>
      <div class="d-flex gap-2 mb-2">
        <span class={`badge ${statusBadgeClass(vote.status)}`}>
          {vote.status.charAt(0).toUpperCase() + vote.status.slice(1)}
        </span>
        <span class="badge text-bg-light border">{VOTE_TYPE_LABELS[vote.voteType]}</span>
        <span class="badge text-bg-light border">{scopeLabel(vote.scopeType)}</span>
      </div>
      <div class="member-card-name">{vote.title}</div>
      {vote.description && (
        <p class="member-card-description">
          {vote.description.length > 160 ? `${vote.description.slice(0, 160).trimEnd()}…` : vote.description}
        </p>
      )}
      <p class="text-muted small mb-0">
        {vote.status === "closed" ? "Closed " : "Closes "}
        {new Date(vote.closesAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
      </p>
    </div>
  );
}

function VoteSectionView({
  title,
  section,
  detailBase,
  loading,
  onLoadMore,
}: {
  title: string;
  section: VoteSection;
  detailBase: string;
  loading: boolean;
  onLoadMore: () => void;
}) {
  if (section.page.total === 0) return null;
  return (
    <section class="mb-5">
      <h3 class="member-letter-heading">{title}</h3>
      <div class="members-grid">
        {section.votes.map((v) => (
          <VoteCard key={v.id} vote={v} detailBase={detailBase} />
        ))}
      </div>
      {section.page.hasMore && (
        <div class="text-center mt-3">
          <button type="button" class="btn btn-outline-secondary" disabled={loading} onClick={onLoadMore}>
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      )}
    </section>
  );
}

function VotesIndex({ apiBase, detailBase }: { apiBase: string; detailBase: string }) {
  const [openSection, setOpenSection] = useState<VoteSection | null>(null);
  const [closedSection, setClosedSection] = useState<VoteSection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState<SectionKey | null>(null);

  useEffect(() => {
    Promise.all([fetchVotesSection(apiBase, "open", 0), fetchVotesSection(apiBase, "closed", 0)])
      .then(([open, closed]) => {
        setOpenSection({ votes: open.votes, page: open.page });
        setClosedSection({ votes: closed.votes, page: closed.page });
      })
      .catch((e) => setError((e as Error).message));
  }, [apiBase]);

  async function loadMore(section: SectionKey) {
    const current = section === "open" ? openSection : closedSection;
    if (!current || !current.page.hasMore || loadingMore) return;
    setLoadingMore(section);
    try {
      const next = await fetchVotesSection(apiBase, section, current.votes.length);
      const merged = mergeVotesSection(current, next);
      if (section === "open") setOpenSection(merged);
      else setClosedSection(merged);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(null);
    }
  }

  if (error) return <ErrorAlert error={error} />;
  if (!openSection || !closedSection) return <Spinner />;

  if (openSection.page.total === 0 && closedSection.page.total === 0) {
    return <p class="text-muted fst-italic text-center mt-3">No public vote results are available yet.</p>;
  }

  return (
    <div class="container-fluid px-2 px-md-4 pb-5">
      <VoteSectionView
        title="Open for voting"
        section={openSection}
        detailBase={detailBase}
        loading={loadingMore === "open"}
        onLoadMore={() => loadMore("open")}
      />
      <VoteSectionView
        title="Closed"
        section={closedSection}
        detailBase={detailBase}
        loading={loadingMore === "closed"}
        onLoadMore={() => loadMore("closed")}
      />
    </div>
  );
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-votes-index]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const detailBase = root.dataset.detailBase ?? "/votes/detail/";
  render(<VotesIndex apiBase={apiBase} detailBase={detailBase} />, root);
}

main();
