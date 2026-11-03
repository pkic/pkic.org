import { buildAttendanceEmailData, buildRegistrationEmailStatusData } from "../../utils/attendance";
import { buildCustomAnswerRows, buildCustomAnswerVariables } from "../../utils/registration-email";
import type { FormFieldDefinition } from "../forms/read";
import type {
  AttendeeDayProjections,
  CampaignRecipient,
  ResolvedAttendeeCampaignRow,
  ResolvedSpeakerCampaignRow,
} from "./types";
import { emailPlainText } from "../../email/plain-text";

/**
 * Merges recipient-specific form values with canonical campaign data. The
 * canonical values deliberately win because configurable form-field keys must
 * never replace trusted event, identity, or route variables.
 */
export function buildPersonalCampaignTemplateData(
  recipient: Pick<CampaignRecipient, "firstName" | "lastName" | "templateData"> | undefined,
  canonicalData: Record<string, unknown>,
  defaultVariableNames: Iterable<string> = [],
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    ...(recipient?.templateData ?? {}),
    ...canonicalData,
    firstName: emailPlainText(recipient?.firstName || "Member"),
    lastName: emailPlainText(recipient?.lastName || ""),
  };
  for (const name of defaultVariableNames) {
    if (!Object.hasOwn(data, name) || data[name] === null || data[name] === undefined) data[name] = "";
  }
  return data;
}

function buildSafeCustomAnswerData(
  customAnswers: Record<string, unknown> | null,
  formFields: FormFieldDefinition[] | undefined,
): { customAnswerRows: Array<Record<string, unknown>>; customAnswerVariables: Record<string, unknown> } {
  const variables = new Map(Object.entries(buildCustomAnswerVariables(customAnswers, formFields)));
  return {
    customAnswerRows: buildCustomAnswerRows(customAnswers, formFields).map((answer) => ({
      label: emailPlainText(answer.label),
      displayValue: emailPlainText(answer.displayValue),
    })),
    customAnswerVariables: Object.fromEntries(
      (formFields ?? []).map((field) => [field.key, emailPlainText(variables.get(field.key) ?? "")]),
    ),
  };
}

export function buildAttendeeCampaignRecipients(
  rows: ResolvedAttendeeCampaignRow[],
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
      projections.attendanceByRegistration.get(row.registration_id) ?? [],
      projections.waitlistByRegistration.get(row.registration_id) ?? [],
    ),
  }));
}

function buildAttendeeTemplateData(
  row: ResolvedAttendeeCampaignRow,
  dayAttendanceRaw: Array<{
    dayDate: string;
    attendanceType: string;
    label: string | null;
    optionLabel?: string | null;
  }>,
  dayWaitlist: Array<{ dayDate: string; status: string }>,
): Record<string, unknown> {
  const customAnswers = row.formResponse.answers;
  const attendanceData = buildAttendanceEmailData(dayAttendanceRaw, dayWaitlist);
  const { customAnswerRows, customAnswerVariables } = buildSafeCustomAnswerData(
    customAnswers,
    row.formResponse.fields ?? undefined,
  );
  return {
    // Custom field keys are configurable. Put them first so they cannot shadow
    // canonical recipient values used by campaign templates.
    ...customAnswerVariables,
    email: emailPlainText(row.email.trim().toLowerCase()),
    organizationName: emailPlainText(row.organization_name ?? ""),
    jobTitle: emailPlainText(row.job_title ?? ""),
    ...buildRegistrationEmailStatusData(row.status, dayWaitlist),
    attendanceLabel: attendanceData.attendanceLabel,
    dayAttendance: attendanceData.dayAttendance,
    dayWaitlist,
    manageUrl: undefined,
    customAnswerRows,
  };
}

export function buildSpeakerTemplateData(row: ResolvedSpeakerCampaignRow): Record<string, unknown> {
  const customAnswers = row.formResponse.answers;
  const { customAnswerRows, customAnswerVariables } = buildSafeCustomAnswerData(
    customAnswers,
    row.formResponse.fields ?? undefined,
  );
  return {
    // Preserve configurable custom tags without allowing them to replace the
    // canonical speaker fields below.
    ...customAnswerVariables,
    email: emailPlainText(row.email.trim().toLowerCase()),
    organizationName: emailPlainText(row.organization_name ?? ""),
    jobTitle: emailPlainText(row.job_title ?? ""),
    speakerStatus: row.speaker_status,
    proposalTitle: emailPlainText(row.proposal_title),
    proposalAbstract: emailPlainText(row.proposal_abstract ?? ""),
    proposalType: emailPlainText(row.proposal_type ?? ""),
    customAnswerRows,
  };
}
