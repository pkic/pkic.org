import { useRef, useState } from "preact/hooks";
import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import type { FormField } from "../../shared/types";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";

export function FormSubmissionForm({
  fields,
  onSubmit,
}: {
  fields: FormFieldDefinition[];
  onSubmit: (answers: Record<string, unknown>) => Promise<void>;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    setSaving(true);
    setError("");
    setSubmitted(false);
    try {
      await onSubmit(readCustomFieldValues(form));
      form.reset();
      setFormVersion((version) => version + 1);
      setSubmitted(true);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={(event) => void submit(event)}>
      <CustomFieldList key={formVersion} fields={fields as FormField[]} context={{ dayAttendance: [] }} />
      <div class="d-flex gap-2 align-items-center">
        <button type="submit" class="btn btn-sm btn-primary" disabled={saving}>
          {saving ? "Submitting…" : "Submit response"}
        </button>
        {submitted && <span class="small text-success">Response submitted.</span>}
        {error && <span class="small text-danger">{error}</span>}
      </div>
    </form>
  );
}
