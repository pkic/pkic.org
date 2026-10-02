/**
 * Public vote detail Public-facing pages). Reads
 * `?slug=` from the query string and fetches GET /api/v1/votes/:slug,
 * mirroring member-detail-page.tsx's `?id=` pattern for the same reason:
 * D1 (not a build-time scan) is the source of truth, so there's no
 * per-vote static page for Hugo to generate at build time.
 *
 * The `result` shape depends on the vote's `publicDetailLevel`:
 * outcome_only carries just `{outcome}` (or, for elections with no
 * `outcome` key written server-side, `{outcome: "decided"}` — see
 * functions/_lib/services/votes.ts `publicResultForDetailLevel`);
 * aggregate/full_breakdown carry the same full shape the portal's own
 * Votes.tsx reads (`{thresholdType, counts, totalBallots, outcome}` for
 * motions/consultations, `{rounds, winnerCandidateId}` for elections).
 * This renders defensively on shape (`"rounds" in result` /
 * `"counts" in result`) rather than assuming the full shape is always
 * present.
 */
import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../shared/api-client";
import { Spinner } from "../components/Spinner";
import { ErrorAlert } from "../components/ErrorAlert";
import { NotFoundPanel } from "../components/NotFoundPanel";
import { publicVoteGetResponseSchema, type PublicVoteGetResponse } from "../../shared/schemas/votes";

import { VoteDetailView } from "../site/PublicVoteDetail";
export { VoteDetailView } from "../site/PublicVoteDetail";
type PublicVote = PublicVoteGetResponse["vote"];

const API_BASE_FALLBACK = "/api/v1";

export function VoteDetailPage({ apiBase, indexHref }: { apiBase: string; indexHref: string }) {
  const [vote, setVote] = useState<PublicVote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const slug = new URLSearchParams(window.location.search).get("slug");
    if (!slug) {
      setNotFound(true);
      return;
    }
    getJson(`${apiBase}/votes/${encodeURIComponent(slug)}`, publicVoteGetResponseSchema)
      .then((response) => setVote(response.vote))
      .catch((e) => {
        if (e instanceof ApiClientError && e.status === 404) setNotFound(true);
        else setError((e as Error).message);
      });
  }, [apiBase]);

  if (notFound) {
    return <NotFoundPanel message="We couldn’t find that vote." backHref={indexHref} backLabel="Back to all votes" />;
  }
  if (error) return <ErrorAlert error={error} />;
  // Named, so the wait says what is loading rather than announcing a bare
  // "Loading…" on a page that is otherwise empty.
  if (!vote) return <Spinner label="Loading vote…" />;

  return <VoteDetailView vote={vote} indexHref={indexHref} />;
}

function main(): void {
  const root = document.querySelector<HTMLElement>("[data-vote-detail]");
  if (!root) return;
  const apiBase = root.dataset.apiBase ?? API_BASE_FALLBACK;
  const indexHref = root.dataset.indexHref ?? "/votes/";
  render(<VoteDetailPage apiBase={apiBase} indexHref={indexHref} />, root);
}

main();
