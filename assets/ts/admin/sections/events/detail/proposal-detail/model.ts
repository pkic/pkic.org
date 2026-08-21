import type {
  AdminProposalDetailResponse,
  ProposalDecisionPreviewResponse,
} from "../../../../../../shared/schemas/admin-event-proposals";
import type { ProposalInternalComment } from "../../../../../../shared/schemas/proposal-comments";

export type { ProposalInternalComment };

export type ProposalResponse = AdminProposalDetailResponse;
export type ProposalDetailRecord = ProposalResponse["proposal"];
export type DecisionPreviewResponse = ProposalDecisionPreviewResponse;

export type DetailTab = "submission" | "speakers" | "reviews" | "presentation" | "audit-log" | "decision";

export function isNeedsWorkDecision(value: string): boolean {
  return value === "needs-work";
}

export interface PresentationVersionReview {
  id: string;
  versionId: string;
  reviewedByUserId: string;
  reviewedAt: string;
  status: "approved" | "rejected" | "needs_revision";
  note: string | null;
}

export interface PresentationVersion {
  id: string;
  proposalId: string;
  versionNumber: number;
  r2Key: string;
  fileName: string | null;
  fileSize: number | null;
  mimeType: string | null;
  uploadedByUserId: string | null;
  uploadedAt: string;
  isCurrent: boolean;
  deletedAt: string | null;
  latestReview: PresentationVersionReview | null;
}
