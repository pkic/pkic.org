import { render } from "preact";
import { Button } from "../../ui/Button";
import { Panel, PanelHeader, PanelBody } from "../../ui/Panel";
import { DescriptionList, type DescriptionListItem } from "../../ui/DescriptionList";
import type { FormField } from "../../shared/types";
import { attendanceTypeLabel } from "../../shared/attendance";
import { readField } from "../../shared/form/helpers";
import { readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { readDayAttendanceChoices } from "../../shared/widgets/day-attendance";
import { ATTENDANCE_WAITLIST_COPY } from "../DayAttendancePicker";
import { formatFormAnswerValue } from "../forms/form-answers";

import type { FormAnswers } from "../../../shared/schemas/form-answers";

function readAttendanceReview(form: HTMLFormElement): Array<{ label: string; value: string }> {
  const days = readDayAttendanceChoices(form);
  if (days.length === 0) {
    return [{ label: "Event attendance", value: attendanceTypeLabel(readField(form, "attendanceType")) }];
  }
  return days.map((day) => ({
    label: day.dayLabel,
    value: day.waitlisted ? `${day.optionLabel} (${ATTENDANCE_WAITLIST_COPY.badge.toLowerCase()})` : day.optionLabel,
  }));
}

function resolveCustomFieldValue(field: FormField, answers: FormAnswers): string {
  const values = formatFormAnswerValue(answers[field.key], field).filter((value) => value !== "-");
  return values.length ? values.join(", ") : "None provided";
}

function visibleCustomFields(root: HTMLElement, fields: FormField[]): FormField[] {
  const visibleKeys = new Set(
    Array.from(root.querySelectorAll<HTMLElement>("[data-custom-field-key]"))
      .filter((row) => row.getAttribute("aria-hidden") !== "true")
      .map((row) => row.dataset.customFieldKey)
      .filter((key): key is string => Boolean(key)),
  );

  return fields.filter((field) => visibleKeys.has(field.key)).sort((a, b) => a.sortOrder - b.sortOrder);
}

function ReviewEditButton({ step, label }: { step: number; label: string }) {
  return (
    <Button type="button" variant="link" data-step-jump={step} aria-label={`Edit ${label}`}>
      Edit
    </Button>
  );
}

function ReviewSection({ title, step, items }: { title: string; step: number; items: DescriptionListItem[] }) {
  return (
    <Panel>
      <PanelHeader title={title}>
        <ReviewEditButton step={step} label={title.toLowerCase()} />
      </PanelHeader>
      <PanelBody>
        <DescriptionList items={items} />
      </PanelBody>
    </Panel>
  );
}

function RegistrationReview({
  fullName,
  email,
  attendance,
  customFields,
  customAnswers,
  form,
}: {
  fullName: string;
  email: string;
  attendance: Array<{ label: string; value: string }>;
  customFields: FormField[];
  customAnswers: FormAnswers;
  form: HTMLFormElement;
}) {
  return (
    <section class="pk-stack" aria-label="Registration review">
      <ReviewSection
        title="Contact"
        step={1}
        items={[
          { term: "Name", value: fullName },
          { term: "Email", value: <span class="pk-break">{email}</span> },
          ...(readField(form, "representationLabel")
            ? [{ term: "Representation", value: readField(form, "representationLabel") }]
            : []),
        ]}
      />
      <ReviewSection
        title="Attendance"
        step={2}
        items={attendance.map((entry) => ({ term: entry.label, value: entry.value }))}
      />
      {customFields.length > 0 && (
        <ReviewSection
          title="Profile details"
          step={3}
          items={customFields.map((field) => ({
            term: field.label,
            value: resolveCustomFieldValue(field, customAnswers),
          }))}
        />
      )}
    </section>
  );
}

export function updateRegistrationReview(root: HTMLElement, form: HTMLFormElement, customFieldDefs: FormField[]): void {
  const firstName = readField(form, "firstName");
  const lastName = readField(form, "lastName");
  const fullName = [firstName, lastName].filter(Boolean).join(" ");
  const email = readField(form, "email");

  const reviewEl = root.querySelector<HTMLElement>("[data-registration-review]");

  if (reviewEl) {
    if (reviewEl.dataset.registrationReviewMounted !== "true") {
      reviewEl.textContent = "";
      reviewEl.dataset.registrationReviewMounted = "true";
    }
    render(
      <RegistrationReview
        fullName={fullName}
        email={email}
        attendance={readAttendanceReview(form)}
        customFields={visibleCustomFields(root, customFieldDefs)}
        customAnswers={readCustomFieldValues(form) as FormAnswers}
        form={form}
      />,
      reviewEl,
    );
  }
}
