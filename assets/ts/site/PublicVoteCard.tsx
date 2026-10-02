import { formatDate } from "../../shared/format-date";
import { StatusBadge } from "./StatusBadge";
import { Badge } from "../ui/Badge";
import type { PublicVotesListResponse } from "../../shared/schemas/votes";
import { VOTE_TYPE_LABELS } from "./PublicVoteDetail";

type PublicVote = PublicVotesListResponse["votes"][number];

export function VoteCard({
  vote,
  detailBase,
  href: publishedHref,
}: {
  vote: PublicVote;
  detailBase?: string;
  href?: string;
}) {
  const href = publishedHref ?? `${detailBase}?slug=${encodeURIComponent(vote.slug)}`;
  return (
    <div class="member-card bento-card">
      <div class="pk-cluster">
        {/* The lifecycle badge comes from the product's own status vocabulary,
            so "open" and "scheduled" read the same here as they do in the
            portal, and the tone carries a dot rather than colour alone. */}
        <StatusBadge status={vote.status} />
        <Badge tone="neutral" dot={false}>
          {VOTE_TYPE_LABELS[vote.voteType]}
        </Badge>
        <Badge tone="neutral" dot={false}>
          {vote.ownerGroupName}
        </Badge>
      </div>
      <a class="member-card-name pk-stretched" href={href}>
        {vote.title}
      </a>
      {vote.description && (
        <p class="member-card-description">
          {vote.description.length > 160 ? `${vote.description.slice(0, 160).trimEnd()}…` : vote.description}
        </p>
      )}
      <p class="pk-small">
        {vote.status === "closed" ? "Closed " : "Closes "}
        {formatDate(vote.closesAt)}
      </p>
    </div>
  );
}
