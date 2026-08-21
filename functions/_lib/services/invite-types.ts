export interface InviteRecord {
  id: string;
  event_id: string;
  inviter_user_id: string | null;
  inviter_registration_id: string | null;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
  link_secret: string;
  status: "sent" | "accepted" | "declined" | "expired" | "revoked";
  decline_reason_code: string | null;
  decline_reason_note: string | null;
  unsubscribe_future: number;
  reminder_count: number;
  last_communication_at: string | null;
  reminders_paused_until: string | null;
  max_uses: number;
  used_count: number;
  source_type: string;
  expires_at: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  transition_revision: number;
  created_at: string;
}

export interface InviteInviterInfo {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  organizationName: string | null;
}

export const INVITE_COLUMNS = `id, event_id, inviter_user_id, inviter_registration_id,
  invitee_email, invitee_first_name, invitee_last_name, invite_type, link_secret,
  status, decline_reason_code, decline_reason_note, unsubscribe_future,
  reminder_count, last_communication_at, reminders_paused_until, max_uses,
  used_count, source_type, expires_at, accepted_at, declined_at,
  transition_revision, created_at`;
