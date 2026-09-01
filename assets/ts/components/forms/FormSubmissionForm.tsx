import { useRef, useState } from "preact/hooks";
import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import type { FormField } from "../../shared/types";
import { CustomFieldList, readCustomFieldValues } from "../../shared/widgets/custom-fields";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";

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
    <form class="pk pk-stack" ref={formRef} onSubmit={(event) => void submit(event)}>
      <CustomFieldList key={formVersion} fields={fields as FormField[]} context={{ dayAttendance: [] }} />
      <div class="pk-cluster">
        <Button type="submit" variant="primary" size="sm" loading={saving} disabled={saving}>
          {saving ? "Submitting…" : "Submit response"}
        </Button>
      </div>
      {/* The outcome is announced as well as shown: `Alert` carries
          role="status" for the confirmation and role="alert" for the failure,
          so the words reach a reader who never sees the tone. */}
      {submitted && <Alert tone="ok">Response submitted.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}
    </form>
  );
}
