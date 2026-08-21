import type { FormFieldDefinition } from "../../shared/schemas/forms";

export type { EventFormsResponse, RequiredTerm } from "../../shared/schemas/forms";
export type { ProposalManageResponse } from "../../shared/schemas/proposal-management";

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: {
      formErrors?: string[];
      fieldErrors?: Record<string, string[]>;
    } | null;
  };
}

export type FormField = Omit<FormFieldDefinition, "id"> & { id?: FormFieldDefinition["id"] };

export interface FormDefinition {
  id: string;
  key: string;
  title: string;
  description: string | null;
  fields: FormField[];
}

export interface RegistrationManageResponse {
  success: true;
  registration: {
    id: string;
    event_id: string;
    status: string;
    cancellation_reason_code: string | null;
    attendance_type: string;
    custom_answers: Record<string, unknown> | null;
    isEmailVerified: boolean;
  };
  event: {
    id: string;
    slug: string;
    name: string;
  } | null;
  user: {
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    organization_name: string | null;
    job_title: string | null;
  } | null;
  eventDays: Array<{
    dayDate: string;
    label: string | null;
    inPersonCapacity: number | null;
    sortOrder: number;
    attendanceOptions: Array<{ value: string; label: string; spotsRemainingPercent?: number | null }>;
  }>;
  dayAttendance: Array<{
    dayDate: string;
    attendanceType: string;
    label: string | null;
  }>;
  dayWaitlist: Array<{
    dayDate: string;
    status: "waiting" | "offered" | "accepted";
    priorityLane: "continuity" | "general";
    offerExpiresAt: string | null;
  }>;
  shareUrl?: string | null;
  manageToken?: string | null;
  headshotUrl?: string | null;
  userId?: string | null;
}
