import { FormSubmissionForm } from "../../../../components/forms/FormSubmissionForm";
import { postJson } from "../../../../shared/api-client";
import { ApiClientError } from "../../../../shared/api-client";
import { toast } from "../../ui";
import { successResponseSchema } from "../../../../../shared/schemas/api-common";
import type { ConsultationFormDefinition } from "../../types";

/**
 * A consultation is answered by filling in its form.
 *
 * This deliberately renders through `FormSubmissionForm`, the same component
 * every other form uses, rather than a vote-specific field renderer. A second
 * implementation would drift from the first the moment a field type is added,
 * and the questions here are ordinary form fields — there is nothing about
 * being asked by a vote that changes how a question should look.
 */
export function ConsultationResponseForm({
  form,
  memberId,
  hasResponded,
  endpoint,
  onResponded,
}: {
  form: ConsultationFormDefinition;
  memberId?: string;
  hasResponded?: boolean;
  endpoint: string;
  onResponded: () => Promise<void>;
}) {
  async function submit(answers: Record<string, unknown>): Promise<void> {
    try {
      await postJson(endpoint, { answers, ...(memberId ? { memberId } : {}) }, successResponseSchema);
      toast(hasResponded ? "Response updated" : "Response recorded", "success");
      await onResponded();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not record your response.";
      toast(message, "error");
      // Rethrow so the shared form keeps the answers on screen rather than
      // clearing them, which would make the person retype everything.
      throw new Error(message, { cause: error });
    }
  }

  return (
    <div>
      {form.description && <p class="text-muted small">{form.description}</p>}
      {hasResponded && <p class="text-muted small">You may change your response until the consultation closes.</p>}
      <FormSubmissionForm fields={form.fields} onSubmit={submit} />
    </div>
  );
}
