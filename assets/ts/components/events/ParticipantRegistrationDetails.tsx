/**
 * What an attendee registered with, as the record's facts.
 *
 * The registration page opens on this list rather than on its form: reading
 * your own registration is the common visit, and a page of open inputs beside
 * a "Cancel registration" button read as "leave without saving". Editing is an
 * explicit command that swaps this list for the form with the same fields.
 */
import type { ComponentChildren } from "preact";
import type { RegistrationManageReadResponse } from "../../../shared/schemas/registration";
import type { EventFormsResponse } from "../../shared/types";
import { attendanceTypeLabel } from "../../shared/attendance";
import { DescriptionList, type DescriptionListItem } from "../../ui/DescriptionList";
import { VerifiedValue } from "../../ui/VerifiedValue";
import { buildFormAnswerRows } from "../forms/form-answers";
import { isIdentityOwnedFormKey } from "../../../shared/schemas/form-answers";
import { RegistrationIdentityChange } from "./RegistrationIdentityChange";
import { registrationAffiliationItems } from "./RegistrationAffiliation";
import { Tooltip } from "../../ui/Tooltip";
import { IconInfoCircle, IconPencil } from "../icons";
import { Button } from "../../ui/Button";

type RegistrationForm = EventFormsResponse["form"];

function dayAttendanceItems(data: RegistrationManageReadResponse): DescriptionListItem[] {
  if (data.eventDays.length === 0) {
    return [{ term: "Attendance", value: "No selected days" }];
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
    .filter((field) => !isIdentityOwnedFormKey(field.key))
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
  onIdentityChanged,
  onEditDetails,
}: {
  data: RegistrationManageReadResponse;
  /** The event's registration questions, or null when it asks none (or they could not be read). */
  form: RegistrationForm;
  /** The page already states each day's confirmed attendance, so the list does not repeat it. */
  daysSummarized: boolean;
  onIdentityChanged?: () => void | Promise<void>;
  onEditDetails?: () => void;
}) {
  const name = [data.user.first_name, data.user.last_name].filter(Boolean).join(" ");
  const details = (editAction?: ComponentChildren) => (
    <div class="pk-stack pk-stack--snug">
      <DescriptionList
        align="baseline"
        items={[
          {
            term: "Name",
            value: (
              <span class="pk-cluster pk-cluster--nowrap">
                {name}
                {onEditDetails && (
                  <Button
                    variant="ghost"
                    icon
                    onClick={onEditDetails}
                    aria-label="Edit registration details"
                    title="Edit registration details"
                  >
                    <IconPencil />
                  </Button>
                )}
              </span>
            ),
          },
          {
            term: "Email address",
            value: (
              <span class="pk-cluster pk-cluster--nowrap">
                <VerifiedValue verified={data.registration.isEmailVerified}>{data.user.email}</VerifiedValue>
                <Tooltip
                  label="About changing your email address"
                  content="Edit your registration details to change your email address, then confirm the new address by email. The address must belong to you; changing it does not transfer your place to someone else."
                >
                  <IconInfoCircle />
                </Tooltip>
              </span>
            ),
          },
          ...registrationAffiliationItems({
            organizationName: data.user.organization_name,
            jobTitle: data.user.job_title,
            pendingOrganizationName: data.pendingOrganizationName,
            editAction,
          }),
          ...(daysSummarized ? [] : dayAttendanceItems(data)),
          ...answerItems(data, form),
        ]}
      />
    </div>
  );
  return onIdentityChanged && data.registration.status !== "cancelled" ? (
    <RegistrationIdentityChange data={data} onChanged={onIdentityChanged}>
      {(edit) => details(edit("Change representation"))}
    </RegistrationIdentityChange>
  ) : (
    details()
  );
}
