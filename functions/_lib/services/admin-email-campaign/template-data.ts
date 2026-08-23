import {
  ATTENDANCE_TYPE_LABELS,
  buildAttendanceEmailData,
  buildRegistrationEmailStatusData,
} from "../../utils/attendance";
import { buildCustomAnswerRows, buildCustomAnswerVariables } from "../../utils/registration-email";
import { parseJsonSafe } from "../../utils/json";
import type { FormFieldDefinition } from "../forms/read";
import type { AttendeeCampaignRow, AttendeeDayProjections, CampaignRecipient, SpeakerCampaignRow } from "./types";

export function buildAttendeeCampaignRecipients(
  rows: AttendeeCampaignRow[],
  formFields: FormFieldDefinition[] | undefined,
  projections: AttendeeDayProjections,
): CampaignRecipient[] {
  return rows.map((row) => ({
    registrationId: row.registration_id,
    manageLinkSecret: row.manage_link_secret,
    userId: row.user_id,
    email: row.email.trim().toLowerCase(),
    firstName: (row.first_name ?? "").trim(),
    lastName: (row.last_name ?? "").trim(),
    templateData: buildAttendeeTemplateData(
      row,
      formFields,
      projections.attendanceByRegistration.get(row.registration_id) ?? [],
      projections.waitlistByRegistration.get(row.registration_id) ?? [],
    ),
  }));
}

function buildAttendeeTemplateData(
  row: AttendeeCampaignRow,
  formFields: FormFieldDefinition[] | undefined,
  dayAttendanceRaw: Array<{ dayDate: string; attendanceType: string; label: string | null }>,
  dayWaitlist: Array<{ dayDate: string; status: string }>,
): Record<string, unknown> {
  const customAnswers = parseJsonSafe<Record<string, unknown> | null>(row.custom_answers_json, null);
  const attendanceType = row.attendance_type ?? "";
  const attendanceData = buildAttendanceEmailData(attendanceType, dayAttendanceRaw, dayWaitlist);
  return {
    email: row.email.trim().toLowerCase(),
    organizationName: row.organization_name ?? "",
    jobTitle: row.job_title ?? "",
    ...buildRegistrationEmailStatusData(row.status, dayWaitlist),
    attendanceType,
    attendanceLabel: attendanceData.attendanceLabel || (ATTENDANCE_TYPE_LABELS[attendanceType] ?? attendanceType),
    dayAttendance: attendanceData.dayAttendance,
    dayWaitlist,
    manageUrl: undefined,
    customAnswerRows: buildCustomAnswerRows(customAnswers, formFields),
    ...buildCustomAnswerVariables(customAnswers, formFields),
  };
}

export function buildSpeakerTemplateData(
  row: SpeakerCampaignRow,
  formFields: FormFieldDefinition[] | undefined,
): Record<string, unknown> {
  const customAnswers = parseJsonSafe<Record<string, unknown> | null>(row.details_json, null);
  return {
    email: row.email.trim().toLowerCase(),
    organizationName: row.organization_name ?? "",
    jobTitle: row.job_title ?? "",
    speakerStatus: row.speaker_status,
    proposalTitle: row.proposal_title,
    proposalAbstract: row.proposal_abstract ?? "",
    proposalType: row.proposal_type ?? "",
    customAnswerRows: buildCustomAnswerRows(customAnswers, formFields),
    ...buildCustomAnswerVariables(customAnswers, formFields),
  };
}
