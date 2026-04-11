export interface EventSummary {
  slug: string;
  name: string;
  timezone: string;
  starts_at: string | null;
  ends_at: string | null;
  registration_mode: string;
  invite_limit_attendee: number;
  confirmed_registrations: number;
  total_registrations: number;
  pending_invites: number;
}

export interface EventDetail extends EventSummary {
  id: string;
  base_path: string | null;
  user_retention_days: number | null;
  venue: string | null;
  virtual_url: string | null;
  hero_image_url: string | null;
  location: string | null;
  session_types: string[] | null;
  settings: Record<string, unknown>;
}

export interface AdminEventDay {
  id: string;
  date: string;
  label: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  attendanceOptions: AdminAttendanceOption[];
  attendanceCounts: Record<string, number>;
}

export interface AdminAttendanceOption {
  value: string;
  label: string;
  capacity?: number | null;
}

export interface AdminEventTerm {
  id: string;
  term_key: string;
  version: string;
  required: number;
  content_ref: string | null;
  display_text: string | null;
  help_text: string | null;
}

export interface AdminEventFormSummary {
  id: string;
  key: string;
  scope_type: string;
  scope_ref: string | null;
  purpose: string;
  status: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
  field_count: number;
  submission_count: number;
}

export interface AdminFormDetailField {
  id: string;
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  options: unknown;
  validation: unknown;
  sortOrder: number;
}

export type ApiFn = <T = unknown>(path: string, opts?: RequestInit & { headers?: Record<string, string> }) => Promise<T>;

export interface Registration {
  id: string;
  user_id: string;
  user_email?: string;
  display_name?: string;
  status: string;
  attendance_type?: string;
  source_type?: string;
  created_at: string;
  referral_code?: string | null;
  rsvp_events_json?: string | null;
  dayAttendance?: Array<{ dayDate: string; attendanceType: string; label: string | null }>;
  dayWaitlist?: Array<{ dayDate: string; status: string; priorityLane: string; offerExpiresAt: string | null }>;
  dayWaitlistSummary?: string | null;
  dayWaitlistCount?: number;
}

export interface AdminRegistrationDay {
  dayDate: string;
  label: string | null;
}

export interface BadgeRoleInfo {
  admin_override: string | null;
  auto_detected: string;
  effective_role: string;
  available_roles: string[];
}

export interface AdminFormSubmission {
  id: string;
  status: string;
  submittedAt: string;
  contextType: string | null;
  contextRef: string | null;
  submitter: {
    id: string;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    organization: string | null;
  } | null;
  answers: Record<string, unknown>;
}

export interface EventPermission {
  id: string;
  user_email: string;
  user_id: string | null;
  permission: string;
  granted_by_id: string;
  created_at: string;
  granter_email: string | null;
}

export interface ProposalSummary {
  id: string;
  event_id: string;
  proposer_user_id: string;
  status: string;
  proposal_type: string;
  title: string;
  abstract: string;
  submitted_at: string;
  updated_at: string;
  proposer_email: string;
  proposer_first_name: string | null;
  proposer_last_name: string | null;
  review_count: number;
  decision_status: string | null;
  decision_note: string | null;
  decision_decided_at: string | null;
}

export interface ProposalReview {
  id: string;
  reviewer_user_id: string;
  recommendation: "accept" | "reject" | "needs-work";
  score: number | null;
  reviewer_comment: string | null;
  applicant_note: string | null;
  updated_at: string;
  reviewer_email?: string;
  reviewer_first_name?: string | null;
  reviewer_last_name?: string | null;
}

export interface ProposalSpeaker {
  userId: string;
  role: string;
  status: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
  hasHeadshot: boolean;
  hasBio: boolean;
}

export interface ProposalAccess {
  eventPermissions: string[];
  canReview: boolean;
  canFinalize: boolean;
}

export interface AdminInviteEntry {
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface InviteRecord {
  id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: string;
  status: string;
  decline_reason_code: string | null;
  decline_reason_note: string | null;
  unsubscribe_future: number;
  source_type: string;
  created_at: string;
  accepted_at: string | null;
  declined_at: string | null;
  inviter_user_id: string | null;
  inviter_email: string | null;
  inviter_first_name: string | null;
  inviter_last_name: string | null;
}

export interface AdminEmailOutboxRow {
  id: string;
  eventSlug: string | null;
  eventName: string | null;
  templateKey: string;
  templateVersion: number | null;
  recipientEmail: string;
  recipientName: string | null;
  subject: string;
  messageType: "transactional" | "promotional";
  provider: string;
  providerMessageId: string | null;
  status: "queued" | "sending" | "sent" | "failed" | "retrying";
  attempts: number;
  sendAfter: string;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  sentAt: string | null;
  bccRecipientCount: number;
  hasCalendarInvite: boolean;
  hasBadgeAttachment: boolean;
  usesDirectBody: boolean;
  hasCustomText: boolean;
}

export interface AdminEmailOutboxResponse {
  outbox: AdminEmailOutboxRow[];
  summary: {
    total: number;
    byStatus: Record<string, number>;
    byMessageType: Record<string, number>;
    topTemplates: Array<{ template_key: string; count: number }>;
    dueNow: number;
    dueByStatus: Record<string, number>;
    nextSendAfter: string | null;
  };
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface AdminJobsRunResponse {
  dryRun: boolean;
  reminders: {
    processed: number;
    inviteRemindersQueued: number;
    speakerInviteRemindersQueued: number;
    presentationRemindersQueued: number;
    preview: {
      attendeeInvites: Array<{
        category: "attendee_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      speakerInvites: Array<{
        category: "speaker_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      coSpeakerInvites: Array<{
        category: "co_speaker_invite";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
      presentationUploads: Array<{
        category: "presentation_upload_request";
        templateKey: string;
        eventName: string;
        eventSlug: string;
        recipientEmail: string;
        recipientName: string | null;
        proposalTitle: string | null;
        reminderNumber: number;
        dueAt: string | null;
        subject: string;
      }>;
    };
  };
  shouldRunRetention: boolean;
  retention: {
    redactedRegistrations: number;
    redactedUsers: number;
    affectedEvents: number;
    preview: {
      dueEvents: Array<{
        eventId: string;
        eventName: string;
        eventSlug: string;
        endsAt: string | null;
        retentionDays: number;
        eligibleRegistrations: number;
        eligibleUsers: number;
      }>;
      totalEvents: number;
      totalRegistrations: number;
      totalUsers: number;
    };
  };
  outbox: {
    processed: number;
    failed: number;
    dueNow: number;
    dueByStatus: Record<string, number>;
    nextSendAfter: string | null;
  };
}

export type AdminReminderPreviewRow = {
  category: "attendee_invite" | "speaker_invite" | "co_speaker_invite" | "presentation_upload_request";
  templateKey: string;
  eventName: string;
  eventSlug: string;
  recipientEmail: string;
  recipientName: string | null;
  proposalTitle: string | null;
  reminderNumber: number;
  dueAt: string | null;
  subject: string;
};

export type AdminDueWorkTab = "all" | "outbox" | "reminders" | "cleanup";

export interface AdminDueWorkRow {
  bucket: Exclude<AdminDueWorkTab, "all">;
  typeLabel: string;
  title: string;
  subtitle: string | null;
  context: string;
  detail: string | null;
  dueAt: string | null;
  statusKey: string;
  statusLabel: string;
}
