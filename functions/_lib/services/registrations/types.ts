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
  confirmation_token_hash: string | null;
  confirmation_token_expires_at: string | null;
  manage_token_hash: string;
  capacity_exempt_in_person: number;
  capacity_exempt_reason: string | null;
  confirmed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}
