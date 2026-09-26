import type { RegistrationCapabilitySafeProjection } from "../../../../assets/shared/schemas/registration";

/** Trusted server-side identity context; a group id always travels with the authenticated user that earned it. */
export interface VerifiedRegistrationIdentityContext {
  userId: string;
  registrationGroupId?: string;
  selectedIdentity?: { id: string; organizationName: string | null; jobTitle: string | null };
}

/** Internal row model extends the stable public subset with storage-only fields. */
export interface RegistrationRecord extends RegistrationCapabilitySafeProjection {
  form_placement_id: string | null;
  registration_group_id: string | null;
  registration_identity_id: string | null;
  registration_organization_name: string | null;
  registration_job_title: string | null;
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
  "form_placement_id",
  "registration_group_id",
  "registration_identity_id",
  "registration_organization_name",
  "registration_job_title",
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
