export interface RegistrationRecord {
  id: string;
  event_id: string;
  user_id: string;
  invite_id: string | null;
  status: string;
  attendance_type: "in_person" | "virtual" | "on_demand";
  source_type: string;
  source_ref: string | null;
  custom_answers_json: string | null;
  referred_by_code: string | null;
  confirmation_link_secret: string | null;
  pending_confirmation_deadline_at: string | null;
  manage_link_secret: string;
  capacity_exempt_in_person: number;
  capacity_exempt_reason: string | null;
  cancellation_reason_code: string | null;
  transition_revision: number;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

const REGISTRATION_COLUMN_NAMES = [
  "id",
  "event_id",
  "user_id",
  "invite_id",
  "status",
  "attendance_type",
  "source_type",
  "source_ref",
  "custom_answers_json",
  "referred_by_code",
  "confirmation_link_secret",
  "pending_confirmation_deadline_at",
  "manage_link_secret",
  "capacity_exempt_in_person",
  "capacity_exempt_reason",
  "cancellation_reason_code",
  "transition_revision",
  "confirmed_at",
  "cancelled_at",
  "created_at",
  "updated_at",
] as const;

export function registrationColumns(tableAlias?: string): string {
  return REGISTRATION_COLUMN_NAMES.map((column) => (tableAlias ? `${tableAlias}.${column}` : column)).join(", ");
}

export const REGISTRATION_COLUMNS = registrationColumns();
