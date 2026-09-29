/**
 * Where the proposal stands with the committee: the facts beside the record.
 *
 * This is the side column of the proposal page, the way an organization's
 * membership facts sit beside its profile. It replaces a "Status" panel and a
 * panel of eight stacked block buttons ("Operator actions") that the old
 * dashboard had; the commands now live in the record's actions menu, and what
 * is left here is what a reader glances at while reading any facet.
 */
import { Badge } from "../../../../../../components/Badge";
import { Badge as ToneBadge } from "../../../../../../ui/Badge";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import type { ProposalReview } from "../../types";
import { fmt } from "../../../../ui";
import type { ProposalDetailRecord } from "./model";

export function ProposalStanding({
  proposal,
  loading,
  reviewCount,
  minReviewsRequired,
  quorumMet,
  averageScore,
  recommendationCounts,
}: {
  proposal: ProposalDetailRecord;
  loading: boolean;
  reviewCount: number;
  minReviewsRequired: number;
  quorumMet: boolean;
  averageScore: number | null;
  recommendationCounts: Record<ProposalReview["recommendation"], number>;
}) {
  const recommendations = (
    [
      ["accept", "Accept", recommendationCounts.accept],
      ["needs-work", "Needs work", recommendationCounts["needs-work"]],
      ["reject", "Reject", recommendationCounts.reject],
    ] as const
  ).filter(([, , count]) => count > 0);

  return (
    <Panel aria-label="Review standing">
      <PanelHeader title="Review standing" />
      <PanelBody>
        <DescriptionList
          density="compact"
          items={[
            { term: "Workflow status", value: <Badge status={proposal.status} /> },
            {
              term: "Decision",
              value: proposal.decision_status ? <Badge status={proposal.decision_status} /> : "Pending",
            },
            {
              term: "Reviews",
              value: (
                <span class="pk-cluster">
                  <span>
                    {loading ? "…" : String(reviewCount)} of {String(minReviewsRequired)} required
                  </span>
                  {/* The verdict in words, in a badge whose tone repeats it
                      rather than replaces it. */}
                  <ToneBadge tone={quorumMet ? "ok" : "warn"}>{quorumMet ? "Quorum met" : "Quorum not met"}</ToneBadge>
                </span>
              ),
            },
            {
              term: "Average score",
              value:
                !loading && reviewCount > 0 && averageScore != null && !Number.isNaN(averageScore)
                  ? averageScore.toFixed(1)
                  : undefined,
            },
            {
              term: "Recommendations",
              value:
                recommendations.length > 0 ? (
                  <span class="pk-cluster">
                    {recommendations.map(([status, label, count]) => (
                      <Badge key={status} status={status} label={`${label} ${String(count)}`} />
                    ))}
                  </span>
                ) : undefined,
            },
            {
              term: "Decided",
              value: proposal.decision_decided_at ? fmt(proposal.decision_decided_at) : undefined,
            },
            { term: "Last updated", value: fmt(proposal.updated_at) },
          ]}
        />
      </PanelBody>
    </Panel>
  );
}
