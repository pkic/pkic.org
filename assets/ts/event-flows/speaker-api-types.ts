export interface SpeakerAccessSummary {
  role: string;
  status: string;
  confirmedAt: string | null;
  declinedAt: string | null;
  termsAcceptedAt: string | null;
}

export interface SpeakerProposalSummary {
  id: string;
  title: string;
  proposalType: string;
  status: string;
  presentationDeadline: string | null;
  presentationUploaded: boolean;
  presentationUploadedAt: string | null;
  presentationUploader: { firstName: string | null; lastName: string | null; uploadedAt: string } | null;
  coSpeakers: Array<{ firstName: string | null; lastName: string | null; status: string }>;
}
