/**
 * Where the proposal stands with the committee: the facts beside the record.
 *
 * This is the side column of the proposal page, the way an organization's
 * membership facts sit beside its profile. It replaces a "Status" panel and a
 * panel of eight stacked block buttons ("Operator actions") that the old
 * dashboard had; the commands now live in the record's actions menu, and what
 * is left here is what a reader glances at while reading any facet.
 *
 * Every value is plain text. A pill per fact — "Accepted", "Quorum met",
 * "Needs work 4" — turned a column of facts into a column of color; the one
 * fact that asks for something, a quorum not yet reached, carries a warning
 * mark before its words instead.
 */
import { formatNumber } from "../../../../../../../shared/format-number";
import { statusLabel } from "../../../../../../components/Badge";
import { AttentionMark } from "../../../../../../ui/AttentionList";
import { DescriptionList } from "../../../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../../../ui/Panel";
import type { ProposalReview } from "../../types";
import { fmt } from "../../../../ui";
import type { ProposalDetailRecord } from "./model";

/** "3 reviews (2 required)": the count first, the threshold it is measured against after it. */
export function reviewTally(reviewCount: number | null, minReviewsRequired: number): string {
  const count = reviewCount === null ? "…" : String(reviewCount);
  return `${count} ${reviewCount === 1 ? "review" : "reviews"} (${String(minReviewsRequired)} required)`;
}

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
            /* One status. A recorded decision moves the workflow to the same
               word, so "Accepted" beside "Accepted" said one thing twice; the
               decision is stated on its own only while it differs. */
            { term: "Status", value: statusLabel(proposal.status) },
            ...(proposal.decision_status && proposal.decision_status !== proposal.status
              ? [{ term: "Decision", value: statusLabel(proposal.decision_status) }]
              : []),
            {
              term: "Reviews",
              value: (
                <span class="pk-stack pk-stack--tight">
                  <span>{reviewTally(loading ? null : reviewCount, minReviewsRequired)}</span>
                  {/* Reaching quorum is the normal course and is said plainly;
                      falling short is what holds a decision back. */}
                  {quorumMet ? <span>Quorum met</span> : <AttentionMark>Quorum not met</AttentionMark>}
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
                recommendations.length > 0
                  ? recommendations.map(([, label, count]) => `${label} ${formatNumber(count)}`).join(", ")
                  : undefined,
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
