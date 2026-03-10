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

export interface FormField {
  key: string;
  label: string;
  fieldType: string;
  required: boolean;
  sortOrder: number;
  options: Array<string | { value: string; label?: string }>;
  validation: Record<string, unknown>;
}

export interface FormDefinition {
  id: string;
  key: string;
  title: string;
  description: string | null;
  fields: FormField[];
}

export interface RequiredTerm {
  termKey: string;
  version: string;
  required: boolean;
  contentRef: string | null;
  displayText?: string | null;
  helpText?: string | null;
}

export interface EventFormsResponse {
  event: {
    id: string;
    slug: string;
    name: string;
  };
  purpose: "event_registration" | "proposal_submission";
  form: FormDefinition | null;
  requiredTerms: RequiredTerm[];
  /** Session types offered for proposal submissions (e.g. "talk", "panel"). */
  allowedSessionTypes?: string[];
  eventDays: Array<{
    dayDate: string;
    label: string | null;
    inPersonCapacity: number | null;
    sortOrder: number;
    attendanceOptions: Array<{ value: string; label: string; spotsRemainingPercent?: number | null }>;
  }>;
}

export interface RegistrationManageResponse {
  success: true;
  registration: {
    id: string;
    event_id: string;
    status: string;
    attendance_type: string;
    custom_answers: Record<string, unknown> | null;
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

export interface ProposalManageResponse {
  success: true;
  proposal: {
    id: string;
    status: string;
    proposal_type: string;
    title: string;
    abstract: string;
    details: Record<string, unknown> | null;
  };
  speakers: Array<{
    userId: string;
    role: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    organizationName: string | null;
    jobTitle: string | null;
    bio: string | null;
    links: string[];
  }>;
}
