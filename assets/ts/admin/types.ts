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
