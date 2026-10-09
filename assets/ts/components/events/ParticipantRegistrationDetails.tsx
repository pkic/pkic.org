/**
 * What an attendee registered with, as the record's facts.
 *
 * The registration page opens on this list rather than on its form: reading
 * your own registration is the common visit, and a page of open inputs beside
 * a "Cancel registration" button read as "leave without saving". Editing is an
 * explicit command that swaps this list for the form with the same fields.
 */
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import type { EventFormsResponse } from "../../shared/types";
import { attendanceTypeLabel } from "../../shared/attendance";
import { DescriptionList, type DescriptionListItem } from "../../ui/DescriptionList";
import { buildFormAnswerRows } from "../forms/form-answers";

type RegistrationForm = EventFormsResponse["form"];

/** Profile answers the form collects are shown once, as the profile's own facts. */
export const PROFILE_ANSWER_KEYS: readonly string[] = ["organization_name", "job_title"];

function dayAttendanceItems(data: RegistrationManageReadResponse): DescriptionListItem[] {
  if (data.eventDays.length === 0) {
    return [{ term: "Attendance", value: attendanceTypeLabel(data.registration.attendance_type) }];
  }
  return data.eventDays.map((day) => {
    const chosen = data.dayAttendance.find((entry) => entry.dayDate === day.dayDate)?.attendanceType;
    const option = day.attendanceOptions.find((candidate) => candidate.value === chosen);
    return {
      term: day.label ?? day.dayDate,
      value: chosen ? (option?.label ?? attendanceTypeLabel(chosen)) : "Not attending",
    };
  });
}

function answerItems(data: RegistrationManageReadResponse, form: RegistrationForm): DescriptionListItem[] {
  const fields = [...(form?.fields ?? [])]
    .filter((field) => !PROFILE_ANSWER_KEYS.includes(field.key))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const known = new Set(fields.map((field) => field.key));
  // Only questions the current form still asks: a stale answer has no label an
  // attendee would recognize, only the stored key.
  return buildFormAnswerRows(data.registration.custom_answers, fields)
    .filter((row) => known.has(row.key))
    .map((row) => ({
      term: row.label,
      value: row.values.filter((value) => value !== "-").join(", "),
    }));
}

export function ParticipantRegistrationDetails({
  data,
  form,
  daysSummarized,
}: {
  data: RegistrationManageReadResponse;
  /** The event's registration questions, or null when it asks none (or they could not be read). */
  form: RegistrationForm;
  /** The page already states each day's confirmed attendance, so the list does not repeat it. */
  daysSummarized: boolean;
}) {
  const name = [data.user.first_name, data.user.last_name].filter(Boolean).join(" ");
  return (
    <DescriptionList
      items={[
        { term: "Name", value: name },
        { term: "Email address", value: data.user.email },
        { term: "Organization", value: data.user.organization_name },
        { term: "Job title", value: data.user.job_title },
        ...(daysSummarized ? [] : dayAttendanceItems(data)),
        ...answerItems(data, form),
      ]}
    />
  );
}
