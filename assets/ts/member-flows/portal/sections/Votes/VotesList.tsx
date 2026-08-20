import { useCallback, useEffect, useState } from "preact/hooks";
import { getJson, ApiClientError } from "../../../../shared/api-client";
import { Spinner } from "../../../../components/Spinner";
import { ErrorAlert } from "../../../../components/ErrorAlert";
import type { PortalVote } from "../../types";
import { VoteCard } from "./VoteCard";

export function VotesList({ wgNames }: { wgNames: Map<string, string> }) {
  const [votes, setVotes] = useState<PortalVote[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await getJson<{ votes: PortalVote[] }>("/api/v1/portal/votes?limit=200");
      setVotes(data.votes);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiClientError ? e.message : "Could not load votes.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (error) return <ErrorAlert error={error} />;
  if (!votes) return <Spinner />;
  if (votes.length === 0) return <p class="text-muted">No votes are visible to you right now.</p>;

  const open = votes.filter((v) => v.status === "open");
  const upcoming = votes.filter((v) => v.status === "scheduled");
  const closed = votes.filter((v) => v.status === "closed" || v.status === "cancelled");

  const groups: { label: string; items: PortalVote[] }[] = [
    { label: "Open for voting", items: open },
    { label: "Upcoming", items: upcoming },
    { label: "Closed", items: closed },
  ];

  return (
    <div class="d-flex flex-column gap-4 content-width-reading">
      {groups
        .filter((g) => g.items.length > 0)
        .map((g) => (
          <div key={g.label}>
            <h3 class="h6 text-muted">{g.label}</h3>
            <div class="d-flex flex-column gap-3">
              {g.items.map((v) => (
                <VoteCard key={v.id} vote={v} wgNames={wgNames} onChanged={reload} />
              ))}
            </div>
          </div>
        ))}
    </div>
  );
}
