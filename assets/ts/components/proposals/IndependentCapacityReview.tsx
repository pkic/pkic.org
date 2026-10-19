import { INDEPENDENT_CAPACITY_REVIEW_COPY as copy } from "../../../shared/email-first-copy";
import {
  independentCapacityDecisionResponseSchema,
  independentCapacityDecisionSchema,
  type IndependentCapacityReview,
  type IndependentCapacityReviewStatus,
} from "../../../shared/schemas/independent-capacity";
import { putJson } from "../../shared/api-client";
import { formatDateTime } from "../../shared/ui";
import { Badge, type BadgeTone } from "../../ui/Badge";
import { DescriptionList } from "../../ui/DescriptionList";
import type { MenuItem } from "../../ui/Menu";
import { confirmAction } from "../ConfirmDialog";

const STATUS_TONE: Record<IndependentCapacityReviewStatus, BadgeTone> = {
  pending: "warn",
  verified: "ok",
  representation_requested: "danger",
};

/** The reviewer flag for a speaker taking part as an individual. */
export function IndependentCapacityBadge({ status }: { status: IndependentCapacityReviewStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{copy.status[status]}</Badge>;
}

/** What the speaker disclosed, for reviewers to weigh against the talk and the bio. */
export function IndependentCapacityDetails({ review }: { review: IndependentCapacityReview }) {
  return (
    <DescriptionList
      density="compact"
      items={[
        { term: copy.currentPosition, value: review.currentPosition },
        { term: copy.formerAffiliations, value: review.formerAffiliations },
        { term: copy.emailAddress, value: copy.emailKind[review.emailDomainKind] },
        { term: copy.attestedAt, value: formatDateTime(review.attestedAt) },
        ...(review.reviewedAt
          ? [
              {
                term: copy.reviewedAt,
                value: [formatDateTime(review.reviewedAt), review.reviewedByName].filter(Boolean).join(" · "),
              },
            ]
          : []),
      ]}
    />
  );
}

/** The reviewer's two decisions, as record-scope menu items; each confirms and is audited server-side. */
export function independentCapacityActions(
  review: IndependentCapacityReview | null | undefined,
  path: string,
  onReviewed: (review: IndependentCapacityReview) => void,
  notify: (message: string, type: "success" | "error") => void,
): MenuItem[] {
  if (!review) return [];
  const decide = async (decision: "verified" | "representation_requested") => {
    const confirmed = await confirmAction({
      title: decision === "verified" ? copy.verify : copy.requestRepresentation,
      consequences: [decision === "verified" ? copy.verifyConsequence : copy.requestConsequence],
      confirmLabel: decision === "verified" ? copy.verify : copy.requestRepresentation,
    });
    if (!confirmed) return;
    try {
      const result = await putJson(
        path,
        independentCapacityDecisionSchema.parse({ decision }),
        independentCapacityDecisionResponseSchema,
      );
      onReviewed(result.review);
      notify(decision === "verified" ? copy.verifiedToast : copy.requestedToast, "success");
    } catch (caught) {
      notify((caught as Error).message, "error");
    }
  };
  return [
    ...(review.status === "verified"
      ? []
      : [
          {
            id: "verify-independent",
            label: copy.verify,
            separatorBefore: true,
            onSelect: () => void decide("verified"),
          },
        ]),
    ...(review.status === "representation_requested"
      ? []
      : [
          {
            id: "request-representation",
            label: copy.requestRepresentation,
            separatorBefore: review.status === "verified",
            onSelect: () => void decide("representation_requested"),
          },
        ]),
  ];
}
