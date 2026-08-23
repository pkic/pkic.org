import type { RegistrationCapabilitySafeProjection } from "../../../../assets/shared/schemas/registration";

/** Internal row model extends the stable public subset with storage-only fields. */
export interface RegistrationRecord extends RegistrationCapabilitySafeProjection {
  confirmation_link_secret: string | null;
  manage_link_secret: string;
  /** Internal authorization state; deliberately excluded from public DTOs. */
  created_identity_user_id: string | null;
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
  "created_identity_user_id",
  "confirmed_at",
  "cancelled_at",
  "created_at",
  "updated_at",
] as const;

export function registrationColumns(tableAlias?: string): string {
  return REGISTRATION_COLUMN_NAMES.map((column) => (tableAlias ? `${tableAlias}.${column}` : column)).join(", ");
}

export const REGISTRATION_COLUMNS = registrationColumns();
