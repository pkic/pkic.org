import { useState } from "preact/hooks";
import type { FormFieldDefinition } from "../../../shared/schemas/forms";
import { ApiClientError } from "../../shared/api-client";
import type { FormField } from "../../shared/types";
import { CustomFieldList } from "../../shared/widgets/custom-fields";
import { Alert } from "../../ui/Alert";
import { Button } from "../../ui/Button";
import { useFormAnswers } from "./useFormAnswers";

/**
 * Answering a form: the questions in the forms respondent controls, validated
 * through the answer contract generated from their definitions — the same
 * contract the server reads the response with — so each question shows its
 * own state, and a refusal from either side lands on the question it is about.
 */
export function FormSubmissionForm({
  fields,
  onSubmit,
}: {
  fields: FormFieldDefinition[];
  onSubmit: (answers: Record<string, unknown>) => Promise<void>;
}) {
  const answers = useFormAnswers(fields);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [formVersion, setFormVersion] = useState(0);

  async function submit(event: Event): Promise<void> {
    event.preventDefault();
    setSubmitted(false);
    const checked = answers.submit();
    if (!checked.data) return setError(checked.formMessage ?? "");
    setSaving(true);
    setError("");
    try {
      await onSubmit(checked.data);
      answers.formRef.current?.reset();
      setFormVersion((version) => version + 1);
      answers.reset();
      answers.sync();
      setSubmitted(true);
    } catch (caught) {
      // A caller may rephrase the server's refusal; the questions it names
      // are still marked from the refusal itself.
      const refusal = caught instanceof ApiClientError ? caught : (caught as Error).cause;
      const marked = refusal instanceof ApiClientError ? answers.refuse(refusal) : "";
      setError(caught instanceof ApiClientError ? marked : (caught as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      class="pk pk-stack"
      ref={answers.formRef}
      noValidate
      {...answers.handlers}
      onSubmit={(event) => void submit(event)}
    >
      <CustomFieldList
        key={formVersion}
        fields={fields as FormField[]}
        context={{ dayAttendance: [] }}
        presentationOf={answers.presentationOf}
      />
      <div class="pk-cluster">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
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
