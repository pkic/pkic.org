import type { EventProposalDetailResponse } from "../../../../../../shared/schemas/event-proposals";
import type { ProposalInternalComment } from "../../../../../../shared/schemas/proposal-comments";
import type {
  PresentationVersion,
  PresentationVersionReview,
} from "../../../../../../shared/schemas/presentation-versions";

export type { PresentationVersion, PresentationVersionReview, ProposalInternalComment };

export type ProposalResponse = EventProposalDetailResponse;
export type ProposalDetailRecord = ProposalResponse["proposal"];

export type DetailTab = "submission" | "speakers" | "reviews" | "presentation" | "audit-log" | "decision";
