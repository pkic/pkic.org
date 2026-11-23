/**
 * The automatic check's stored reading of a proposal, member page or bio, beside
 * the review it supports. It decides nothing: the concerns are what the author
 * was told when they saved, and any scores follow the check's rubric.
 */
import { CLASSIFIER_OUTCOME_LABELS, classifierRaisesConcerns } from "../../../../../shared/classifiers";
import type { ClassifierResult } from "../../../../../shared/schemas/classifiers";
import { formatNumber } from "../../../../../shared/format-number";
import { AttentionMark } from "../../../../ui/AttentionList";
import { DescriptionList } from "../../../../ui/DescriptionList";
import { Panel, PanelBody, PanelHeader } from "../../../../ui/Panel";
import { fmt } from "../../ui";

export function AutomaticReview({ review }: { review: ClassifierResult }) {
  const concerns = classifierRaisesConcerns(review.outcome);
  return (
    <Panel aria-label="Automatic review">
      <PanelHeader title="Automatic review" />
      <PanelBody>
        <DescriptionList
          density="compact"
          items={[
            {
              term: "Screening",
              value: concerns ? (
                <AttentionMark>{CLASSIFIER_OUTCOME_LABELS[review.outcome]}</AttentionMark>
              ) : (
                CLASSIFIER_OUTCOME_LABELS[review.outcome]
              ),
            },
            {
              term: "Concerns",
              value: review.flags.length ? (
                <span class="pk-stack pk-stack--tight">
                  {review.flags.map((flag) => (
                    <span key={flag.id}>
                      {flag.message} ({formatNumber(flag.probabilityPercent)}%)
                    </span>
                  ))}
                </span>
              ) : undefined,
            },
            {
              term: "Score",
              value: review.scorePercent === null ? undefined : `${formatNumber(Math.round(review.scorePercent))}%`,
            },
            ...review.scores.map((score) => ({ key: `score:${score.id}`, term: score.label, value: score.level })),
            { term: "Checked", value: fmt(review.checkedAt) },
          ]}
        />
      </PanelBody>
    </Panel>
  );
}
