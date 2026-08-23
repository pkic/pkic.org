import type { z } from "zod";
import type { EmailMessageType } from "../../../../assets/shared/schemas/admin-email-templates";
import { adminEventCampaignPreviewSchema } from "../../../../assets/shared/schemas/admin-events";
import type { AttendanceType } from "../../../../assets/shared/schemas/registration";
import type { EventRecord } from "../events";
import type { ResolvedEmailTemplate } from "../../email/templates";

export type AdminCampaignInput = z.infer<typeof adminEventCampaignPreviewSchema>;

export type CampaignEvent = Pick<EventRecord, "id" | "slug" | "base_path" | "starts_at" | "settings_json">;

export interface CampaignRecipient {
  registrationId?: string;
  /** Internal delivery-time capability binding; never serialized into template data. */
  manageLinkSecret?: string;
  userId?: string;
  email: string;
  firstName: string;
  lastName: string;
  templateData: Record<string, unknown>;
}

export interface CampaignAudienceFilter {
  audience: "attendees" | "speakers";
  attendeeStatus?: "all" | "registered" | "pending_email_confirmation" | "cancelled";
  attendanceType?: "all" | AttendanceType;
  dayDate?: string;
  dayWaitlistStatus?: "all" | "active" | "waiting" | "offered" | "accepted" | "none";
  speakerStatus?: "all" | "confirmed" | "invited" | "pending";
}

export interface AttendeeCampaignRow {
  registration_id: string;
  manage_link_secret: string;
  user_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  status: string;
  attendance_type: string | null;
  custom_answers_json: string | null;
}

export interface AttendeeDayAttendanceRow {
  registration_id: string;
  dayDate: string;
  attendanceType: string;
  label: string | null;
}

export interface AttendeeDayWaitlistRow {
  registration_id: string;
  dayDate: string;
  status: string;
}

export type AttendeeDayAttendance = {
  dayDate: string;
  attendanceType: string;
  label: string | null;
};

export type AttendeeDayWaitlist = {
  dayDate: string;
  status: string;
};

export interface AttendeeDayProjections {
  attendanceByRegistration: Map<string, AttendeeDayAttendance[]>;
  waitlistByRegistration: Map<string, AttendeeDayWaitlist[]>;
}

export interface SpeakerCampaignRow {
  email: string;
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  speaker_status: string;
  proposal_title: string;
  proposal_abstract: string | null;
  proposal_type: string | null;
  details_json: string | null;
  proposal_updated_at: string | null;
  speaker_confirmed_at: string | null;
}

export type CampaignTemplate = Pick<
  ResolvedEmailTemplate,
  "subjectTemplate" | "content" | "contentType" | "messageType"
>;

export interface PreparedAdminCampaign {
  template: CampaignTemplate | null;
  messageType: EmailMessageType;
  filter: CampaignAudienceFilter;
  recipients: CampaignRecipient[];
  digest: string;
}
