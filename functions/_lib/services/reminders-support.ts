import { addHours } from "../utils/time";
import { parseJsonSafe } from "../utils/json";

export interface EventRouteRow {
  id: string;
  name: string;
  slug: string;
  base_path: string | null;
  starts_at: string | null;
  settings_json: string;
}

export interface DueInviteRow {
  id: string;
  event_id: string;
  invitee_email: string;
  invitee_first_name: string | null;
  invitee_last_name: string | null;
  invite_type: "attendee" | "speaker";
  reminder_count: number;
  expires_at: string | null;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
}

interface EventReminderSettings {
  registrationClosesAt?: string | null;
  registration?: {
    closesAt?: string | null;
  };
}

export function attendeeRegistrationClosesAt(invite: DueInviteRow): string | null {
  const settings = parseJsonSafe<EventReminderSettings>(invite.event_settings_json, {});
  return settings.registration?.closesAt ?? settings.registrationClosesAt ?? null;
}

export interface DuePresentationRow {
  speaker_id: string;
  proposal_id: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  proposal_title: string;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
  presentation_deadline: string | null;
  reminder_count: number;
}

export interface DueSpeakerInviteRow {
  speaker_id: string;
  proposal_id: string;
  user_id: string;
  role: string;
  speaker_status: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  proposal_title: string;
  proposer_first_name: string | null;
  event_id: string;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_starts_at: string | null;
  event_settings_json: string;
  reminder_count: number;
}

export interface ConfirmationReminderRow {
  id: string;
  event_id: string;
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  confirmation_token_hash: string;
  confirmation_token_expires_at: string;
  confirmation_reminder_sent_at: string | null;
  pending_confirmation_deadline_at: string | null;
  created_at: string;
  event_name: string;
  event_slug: string;
  event_base_path: string | null;
  event_timezone: string;
  event_starts_at: string | null;
  event_ends_at: string | null;
  event_settings_json: string;
}

export interface ReminderCandidatePreview {
  category:
    | "attendee_invite"
    | "speaker_invite"
    | "co_speaker_invite"
    | "presentation_upload_request"
    | "registration_confirmation";
  templateKey: string;
  eventName: string;
  eventSlug: string;
  recipientEmail: string;
  recipientName: string | null;
  proposalTitle: string | null;
  reminderNumber: number;
  dueAt: string | null;
  subject: string;
}

export function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now;
  return Math.ceil(diff / 86_400_000);
}

export function inviteReminderSubject(eventName: string, reminderNumber: number, daysToExpiry: number | null): string {
  if (daysToExpiry !== null && daysToExpiry <= 2) {
    return `Final reminder: your invitation expires soon — ${eventName}`;
  }
  const variants = [
    `Reminder: your invitation to ${eventName}`,
    `Still interested in ${eventName}?`,
    `Quick follow-up: ${eventName} invitation`,
  ];
  return variants[(Math.max(1, reminderNumber) - 1) % variants.length];
}

export function presentationReminderSubject(
  eventName: string,
  reminderNumber: number,
  daysToDeadline: number | null,
): string {
  if (daysToDeadline !== null && daysToDeadline <= 1) {
    return `Final call: upload your presentation today — ${eventName}`;
  }
  if (daysToDeadline !== null && daysToDeadline <= 3) {
    return `Urgent: presentation upload deadline is near — ${eventName}`;
  }
  const variants = [
    `Reminder: please upload your presentation — ${eventName}`,
    `We still need your slides for ${eventName}`,
    `Quick follow-up: presentation upload for ${eventName}`,
  ];
  return variants[(Math.max(1, reminderNumber) - 1) % variants.length];
}

export function earlierIso(left: string, right: string): string {
  return new Date(left).getTime() <= new Date(right).getTime() ? left : right;
}

export function pendingConfirmationDeadline(
  row: Pick<ConfirmationReminderRow, "pending_confirmation_deadline_at" | "created_at">,
): string {
  return row.pending_confirmation_deadline_at ?? addHours(row.created_at, 14 * 24);
}

export function hoursUntilIso(iso: string, now = Date.now()): number {
  const diff = new Date(iso).getTime() - now;
  return Math.max(0, Math.ceil(diff / 3_600_000));
}

export function formatPendingConfirmationTimeLeft(deadlineIso: string, now = Date.now()): string {
  const hoursLeft = hoursUntilIso(deadlineIso, now);
  if (hoursLeft <= 24) {
    return `${Math.max(1, hoursLeft)} hours`;
  }
  const daysLeft = Math.ceil(hoursLeft / 24);
  return `${daysLeft} day${daysLeft === 1 ? "" : "s"}`;
}

export function confirmationReminderSubject(eventName: string, deadlineIso: string, now = Date.now()): string {
  return hoursUntilIso(deadlineIso, now) <= 24
    ? `Final reminder: confirm your registration or it will be cancelled — ${eventName}`
    : `Reminder: please confirm your registration for ${eventName}`;
}
