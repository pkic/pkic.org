import type { ProposalDecisionStatus } from "../../../../assets/shared/schemas/proposal-status";
import type { AuthAdmin } from "../../types";

export interface ProposalDecisionNotification {
  id: string;
  templateKey: string;
  recipientEmail: string;
  recipientUserId: string;
  fallbackSubject: string;
  data: Record<string, unknown>;
}

export interface RecordProposalDecisionInput {
  proposalId: string;
  actor: AuthAdmin;
  finalStatus: ProposalDecisionStatus;
  decisionNote?: string | null;
  minReviewsRequired: number;
  presentationDeadline?: string | null;
  presentationReminderUserIds?: string[];
  notifications?: ProposalDecisionNotification[];
  expectedProposalUpdatedAt?: string;
}

export interface RecordedProposalDecision {
  decisionId: string;
  reviewRound: number;
  reviewCount: number;
  outboxIds: string[];
}

export interface ProposalDecisionEmailMessage extends ProposalDecisionNotification {
  templateKey: "proposal_decision" | "speaker_profile_request" | "presentation_upload_request";
  recipientLabel: string;
}

export interface ProposalDecisionEmailPlan {
  proposal: {
    id: string;
    title: string;
    event_id: string;
    proposer_user_id: string;
    presentation_deadline: string | null;
    proposal_type: string;
    status: string;
    has_current_decision: number;
    updated_at: string;
  };
  messages: ProposalDecisionEmailMessage[];
  presentationReminderUserIds: string[];
}
