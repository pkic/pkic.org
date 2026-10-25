import { render, type ComponentChildren } from "preact";
import type { FormField } from "../../shared/types";
import { attendanceTypeLabel } from "../../shared/attendance";
import { readField } from "../../shared/form/helpers";
import { readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { ATTENDANCE_WAITLIST_COPY } from "../DayAttendancePicker";
import { optionsFor } from "../../shared/form/custom-field-rules";

type CustomAnswerValue = string | number | boolean | string[] | { start: string; end: string };

function readAttendanceReview(form: HTMLFormElement): Array<{ label: string; value: string }> {
  const selected = Array.from(form.querySelectorAll<HTMLInputElement>("input[name^='dayAttendance.']:checked"));
  if (selected.length === 0) {
    return [{ label: "Event attendance", value: attendanceTypeLabel(readField(form, "attendanceType")) }];
  }

  return selected
    .map((field) => {
      const day = field.closest<HTMLElement>(".event-flow-day");
      const dayLabel = day?.querySelector<HTMLElement>(".event-flow-day-label")?.textContent?.trim();
      const optionLabel = field.nextElementSibling
        ?.querySelector<HTMLElement>(".event-flow-attendance-title")
        ?.textContent?.trim();
      const value = optionLabel || field.value;
      // A full option joins the waitlist; the review says so where the choice is checked.
      return {
        label: dayLabel || field.name.replace(/^dayAttendance\./, ""),
        value: field.hasAttribute("data-waitlist")
          ? `${value} (${ATTENDANCE_WAITLIST_COPY.badge.toLowerCase()})`
          : value,
      };
    })
    .filter((entry) => entry.label || entry.value);
}

function resolveCustomFieldValue(
  form: HTMLFormElement,
  field: FormField,
  answers: Record<string, CustomAnswerValue>,
): { value: string; empty: boolean } {
  const raw = answers[field.key];
  const options = optionsFor(field);
  const optionLabel = (value: string): string => options.find((option) => option.value === value)?.label ?? value;

  if (Array.isArray(raw)) {
    return raw.length > 0
      ? { value: raw.map(optionLabel).join(", "), empty: false }
      : { value: "None provided", empty: true };
  }

  if (typeof raw === "object" && raw !== null) {
    const start = raw.start?.trim();
    const end = raw.end?.trim();
    return start && end ? { value: `${start} to ${end}`, empty: false } : { value: "None provided", empty: true };
  }

  if (typeof raw === "boolean") {
    return { value: raw ? "Yes" : "No", empty: false };
  }

  if (typeof raw === "number") {
    return { value: String(raw), empty: false };
  }

  if (typeof raw === "string" && raw.trim()) {
    const select = form.querySelector<HTMLSelectElement>(`select[name='custom.${field.key}']`);
    const selectedLabel = select?.selectedOptions[0]?.textContent?.trim();
    return { value: selectedLabel || optionLabel(raw.trim()), empty: false };
  }

  return { value: "None provided", empty: true };
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
    <button type="button" class="event-flow-review-edit" data-step-jump={step} aria-label={`Edit ${label}`}>
      Edit
    </button>
  );
}

function ReviewSection({ title, step, children }: { title: string; step: number; children: ComponentChildren }) {
  return (
    <section class="event-flow-review-section" aria-labelledby={`registration-review-${step}`}>
      <div class="event-flow-review-section-heading">
        <div>
          <p class="event-flow-review-section-title" id={`registration-review-${step}`}>
            {title}
          </p>
        </div>
        <ReviewEditButton step={step} label={title.toLowerCase()} />
      </div>
      <dl class="event-flow-review-list">{children}</dl>
    </section>
  );
}

function ReviewRow({
  label,
  value,
  empty = false,
  valueClass,
}: {
  label: string;
  value: string;
  empty?: boolean;
  valueClass?: string;
}) {
  const className = [empty ? "text-muted" : "", valueClass ?? ""].filter(Boolean).join(" ") || undefined;

  return (
    <div class="event-flow-review-row">
      <dt>{label}</dt>
      <dd class={className}>{value}</dd>
    </div>
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
  customAnswers: Record<string, CustomAnswerValue>;
  form: HTMLFormElement;
}) {
  return (
    <section class="event-flow-review" aria-label="Registration review">
      <ReviewSection title="Contact" step={1}>
        <ReviewRow label="Name" value={fullName || "Not provided yet"} empty={!fullName} />
        <ReviewRow
          label="Email"
          value={email || "Not provided yet"}
          empty={!email}
          valueClass="event-flow-review-email-inline"
        />
      </ReviewSection>

      <ReviewSection title="Attendance" step={2}>
        {attendance.map((entry) => (
          <ReviewRow key={`${entry.label}-${entry.value}`} label={entry.label} value={entry.value} />
        ))}
      </ReviewSection>

      {customFields.length > 0 && (
        <ReviewSection title="Profile details" step={3}>
          {customFields.map((field) => {
            const resolved = resolveCustomFieldValue(form, field, customAnswers);
            return <ReviewRow key={field.key} label={field.label} value={resolved.value} empty={resolved.empty} />;
          })}
        </ReviewSection>
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
        customAnswers={readCustomFieldValues(form) as Record<string, CustomAnswerValue>}
        form={form}
      />,
      reviewEl,
    );
  }
}
