import type { AdminFormDetailField, ProposalAccess, ProposalSummary } from "../../../../types";

export interface ProposalDetailRecord extends ProposalSummary {
  details?: Record<string, unknown> | null;
}

export interface ProposalFormSummary {
  id: string;
  title: string;
  description: string | null;
  fields: AdminFormDetailField[];
}

export interface SessionTypeConfig {
  label: string;
  requiresPresentation: boolean;
}

export interface ProposalResponse {
  proposal: ProposalDetailRecord;
  access: ProposalAccess;
  form: ProposalFormSummary | null;
  minReviewsRequired: number;
  sessionTypes: SessionTypeConfig[];
}

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

export interface ProposalInternalComment {
  id: string;
  proposal_id: string;
  author_user_id: string;
  comment: string;
  created_at: string;
  updated_at: string;
  author_email: string | null;
  author_first_name: string | null;
  author_last_name: string | null;
}

export interface DecisionPreviewMessage {
  id: string;
  templateKey: string;
  recipientEmail: string;
  recipientLabel: string;
  subject: string;
  html: string;
  text: string;
  templateMissing?: boolean;
}

export interface DecisionPreviewResponse {
  recipientCount: number;
  emailCount: number;
  layoutMissing?: boolean;
  missingTemplateKeys?: string[];
  messages: DecisionPreviewMessage[];
}
